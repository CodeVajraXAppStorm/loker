import { Capacitor, registerPlugin } from "@capacitor/core";
import { jsPDF } from "jspdf";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { App } from "@capacitor/app";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

/* =========================================================
   VAULTX - PERSONAL DOCUMENT LOCKER
   Main JavaScript
   ========================================================= */

/* =========================
   CONFIGURATION
========================= */

const DB_NAME = "VaultXDatabase";
const DB_VERSION = 1;
const STORE_NAME = "documents";

const MAX_FILE_SIZE = 25 * 1024 * 1024;

let db = null;

let documents = [];
let selectedCategory = "All";
let selectedDocumentId = null;

let currentPin = "";
let pinMode = "setup";

let firstPin = "";
let isChangingPin = false;
let sortNewestFirst = true;

/* =========================
   DOM ELEMENTS
========================= */

const lockScreen = document.getElementById("lockScreen");
const mainApp = document.getElementById("mainApp");

const pinHeading = document.getElementById("pinHeading");
const pinDescription = document.getElementById("pinDescription");
const pinMessage = document.getElementById("pinMessage");
const pinDots = document.getElementById("pinDots");

const fingerprintBtn = document.getElementById("fingerprintBtn");

const searchInput = document.getElementById("searchInput");

const documentGrid = document.getElementById("documentGrid");
const emptyState = document.getElementById("emptyState");

const addModal = document.getElementById("addModal");
const previewModal = document.getElementById("previewModal");
const settingsModal = document.getElementById("settingsModal");

const documentNameInput = document.getElementById("documentName");
const documentCategoryInput = document.getElementById("documentCategory");
const documentExpiryInput = document.getElementById("documentExpiry");

const documentFileInput = document.getElementById("documentFile");

const filePickerText = document.getElementById("filePickerText");
const addDocumentMessage = document.getElementById("addDocumentMessage");

const previewTitle = document.getElementById("previewTitle");
const previewInfo = document.getElementById("previewInfo");
const previewContent = document.getElementById("previewContent");

const toast = document.getElementById("toast");

/* =========================
   DATABASE
========================= */

function openDatabase() {

  return new Promise((resolve, reject) => {

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {

      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {

        const store = database.createObjectStore(
          STORE_NAME,
          { keyPath: "id" }
        );

        store.createIndex("name", "name", {
          unique: false
        });

        store.createIndex("category", "category", {
          unique: false
        });

        store.createIndex("createdAt", "createdAt", {
          unique: false
        });

      }

    };

    request.onsuccess = event => {

      db = event.target.result;

      resolve(db);

    };

    request.onerror = () => {

      reject(request.error);

    };

  });

}

function databaseRequest(mode, operation) {

  return new Promise((resolve, reject) => {

    const transaction = db.transaction(
      STORE_NAME,
      mode
    );

    const store = transaction.objectStore(STORE_NAME);

    let request;

    try {

      request = operation(store);

    } catch (error) {

      reject(error);

      return;

    }

    request.onsuccess = () => {

      resolve(request.result);

    };

    request.onerror = () => {

      reject(request.error);

    };

  });

}

function saveDocumentToDatabase(documentData) {

  return databaseRequest(
    "readwrite",
    store => store.put(documentData)
  );

}

function getAllDocumentsFromDatabase() {

  return databaseRequest(
    "readonly",
    store => store.getAll()
  );

}

function deleteDocumentFromDatabase(id) {

  return databaseRequest(
    "readwrite",
    store => store.delete(id)
  );

}

/* =========================
   PIN SECURITY
========================= */

async function hashPin(pin) {

  const encoder = new TextEncoder();

  const data = encoder.encode(pin);

  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  const hashArray = Array.from(
    new Uint8Array(hashBuffer)
  );

  return hashArray
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");

}

function getSavedPinHash() {

  return localStorage.getItem("vaultx_pin_hash");

}

async function savePin(pin) {

  const hash = await hashPin(pin);

  localStorage.setItem(
    "vaultx_pin_hash",
    hash
  );

}

function updatePinDots() {

  const dots = pinDots.querySelectorAll("span");

  dots.forEach((dot, index) => {

    dot.classList.toggle(
      "filled",
      index < currentPin.length
    );

  });

}

function resetPinInput() {

  currentPin = "";

  updatePinDots();

}

function setPinScreen(mode) {

  pinMode = mode;

  resetPinInput();

  pinMessage.textContent = "";

  fingerprintBtn.classList.remove("hidden");

  if (mode === "setup") {

    pinHeading.textContent = "Create your PIN";

    pinDescription.textContent =
      "Create a 4-digit PIN to secure your documents.";

  }

  else if (mode === "confirm") {

    pinHeading.textContent = "Confirm your PIN";

    pinDescription.textContent =
      "Enter the same PIN again.";

  }

  else if (mode === "unlock") {

    pinHeading.textContent = "Welcome Back";

    pinDescription.textContent =
      "Enter your PIN to unlock VaultX.";

  }

  else if (mode === "change") {

    pinHeading.textContent = "Create New PIN";

    pinDescription.textContent =
      "Enter your new 4-digit PIN.";

  }

  updatePinDots();

}

async function handlePinComplete() {

  if (pinMode === "setup") {

    firstPin = currentPin;

    setPinScreen("confirm");

    return;

  }

  if (pinMode === "confirm") {

    if (currentPin !== firstPin) {

      pinMessage.textContent =
        "PIN does not match. Try again.";

      resetPinInput();

      return;

    }

    await savePin(currentPin);

    firstPin = "";

    isChangingPin = false;

    unlockVault();

    showToast("Vault created successfully");

    return;

  }

  if (pinMode === "change") {

    await savePin(currentPin);

    isChangingPin = false;

    unlockVault();

    showToast("PIN changed successfully");

    return;

  }

  if (pinMode === "unlock") {

    const savedHash = getSavedPinHash();

    const enteredHash = await hashPin(currentPin);

    if (enteredHash === savedHash) {

      unlockVault();

    } else {

      pinMessage.textContent =
        "Incorrect PIN. Please try again.";

      resetPinInput();

    }

  }

}

function handlePinKey(key) {

  if (key === "delete") {

    currentPin = currentPin.slice(0, -1);

    updatePinDots();

    return;

  }

  if (!/^\d$/.test(key)) return;

  if (currentPin.length >= 4) return;

  currentPin += key;

  updatePinDots();

  if (currentPin.length === 4) {

    setTimeout(() => {

      handlePinComplete();

    }, 150);

  }

}

document.querySelectorAll(".pin-key").forEach(button => {

  button.addEventListener("click", () => {

    const key = button.dataset.key;

    if (key) {

      handlePinKey(key);

    }

  });

});

/* =========================
   VAULT LOCK / UNLOCK
========================= */

function unlockVault() {

  lockScreen.classList.add("hidden");

  mainApp.classList.remove("hidden");

  resetPinInput();

  loadDocuments();

}

function lockVault() {

  mainApp.classList.add("hidden");

  lockScreen.classList.remove("hidden");

  setPinScreen("unlock");

}

document.getElementById("lockBtn").addEventListener(
  "click",
  lockVault
);

document.getElementById("settingsLockBtn").addEventListener(
  "click",
  () => {

    closeModal("settingsModal");

    lockVault();

  }
);

/* =========================
   FINGERPRINT PLACEHOLDER
========================= */

fingerprintBtn.addEventListener("click", () => {

  showToast(
    "Native fingerprint authentication will be added in the next security phase."
  );

});

/* =========================
   DOCUMENT IMPORT
========================= */

function openAddDocumentModal() {

  documentNameInput.value = "";

  documentCategoryInput.value = "Identity";

  documentExpiryInput.value = "";

  documentFileInput.value = "";

  filePickerText.textContent = "Choose PDF or Image";

  addDocumentMessage.textContent = "";

  resetScanState();

  openModal("addModal");

}

document.getElementById("emptyAddBtn").addEventListener(
  "click",
  openAddDocumentModal
);

documentFileInput.addEventListener("change", () => {

  const file = documentFileInput.files[0];

  if (!file) {

    filePickerText.textContent = "Choose PDF or Image";

    return;

  }

  filePickerText.textContent = file.name;

  if (!documentNameInput.value.trim()) {

    documentNameInput.value = file.name.replace(/\.[^/.]+$/, "");

  }

});

document.getElementById("saveDocumentBtn").addEventListener(
  "click",
  saveNewDocument
);

async function saveNewDocument() {

  const name = documentNameInput.value.trim();

  const category = documentCategoryInput.value;

  const expiryDate = documentExpiryInput.value;

  const pickedFile = documentFileInput.files[0];

  addDocumentMessage.textContent = "";

  if (!name) {

    addDocumentMessage.textContent =
      "Please enter a document name.";

    return;

  }

  let fileBlob;
  let fileName;
  let fileType;
  let backBlob = null;

  const frontBlob = scanFrontBlob || pickedImageBlob;

  if (frontBlob) {

    fileBlob = frontBlob;

    fileType = "image/jpeg";

    fileName = scanFrontBlob
      ? safeFileName(name) + ".jpg"
      : pickedImageName;

    backBlob = scanBackBlob;

  }

  else if (scanBackBlob) {

    addDocumentMessage.textContent =
      "Please add the front side first.";

    return;

  }

  else if (pickedFile) {

    if (pickedFile.size > MAX_FILE_SIZE) {

      addDocumentMessage.textContent =
        "File is too large. Maximum size is 25 MB.";

      return;

    }

    const isPdf = pickedFile.type === "application/pdf";

    const isImage = pickedFile.type.startsWith("image/");

    if (!isPdf && !isImage) {

      addDocumentMessage.textContent =
        "Only PDF and image files are supported.";

      return;

    }

    fileBlob = pickedFile;

    fileType = pickedFile.type;

    fileName = pickedFile.name;

  }

  else {

    addDocumentMessage.textContent =
      "Please choose a file or scan a document.";

    return;

  }

  const documentData = {

    id: crypto.randomUUID(),

    name,

    category,

    expiryDate,

    fileName,

    fileType,

    fileSize: fileBlob.size + (backBlob ? backBlob.size : 0),

    fileBlob,

    createdAt: Date.now()

  };

  if (backBlob) {

    documentData.backBlob = backBlob;

  }

  try {

    await saveDocumentToDatabase(documentData);

    closeModal("addModal");

    resetScanState();

    await loadDocuments();

    showToast("Document saved offline");

  } catch (error) {

    console.error(error);

    addDocumentMessage.textContent =
      "Could not save document. Please try again.";

  }

}

/* =========================
   LOAD DOCUMENTS
========================= */

async function loadDocuments() {

  try {

    documents = await getAllDocumentsFromDatabase();

    renderDocuments();

    updateCategoryCounts();

  } catch (error) {

    console.error(error);

    showToast("Could not load documents");

  }

}

/* =========================
   DOCUMENT RENDERING
========================= */

function getFilteredDocuments() {

  const searchTerm = searchInput.value
    .trim()
    .toLowerCase();

  let filtered = documents.filter(documentData => {

    const matchesCategory =
      selectedCategory === "All" ||
      documentData.category === selectedCategory;

    const matchesSearch =
      documentData.name.toLowerCase().includes(searchTerm) ||
      documentData.fileName.toLowerCase().includes(searchTerm) ||
      documentData.category.toLowerCase().includes(searchTerm);

    return matchesCategory && matchesSearch;

  });

  filtered.sort((a, b) => {

    return sortNewestFirst
      ? b.createdAt - a.createdAt
      : a.createdAt - b.createdAt;

  });

  return filtered;

}

function formatFileSize(bytes) {

  if (bytes < 1024) {

    return bytes + " B";

  }

  if (bytes < 1024 * 1024) {

    return (bytes / 1024).toFixed(1) + " KB";

  }

  return (bytes / (1024 * 1024)).toFixed(1) + " MB";

}

function formatDate(timestamp) {

  return new Date(timestamp).toLocaleDateString(
    "en-IN",
    {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }
  );

}

function getDocumentIcon(documentData) {

  if (documentData.fileType === "application/pdf") {

    return {
      className: "pdf",
      icon: "PDF"
    };

  }

  return {
    className: "image",
    icon: "▧"
  };

}

function renderDocuments() {

  const filteredDocuments = getFilteredDocuments();

  documentGrid.innerHTML = "";

  emptyState.classList.toggle(
    "show",
    filteredDocuments.length === 0
  );

  if (filteredDocuments.length === 0) {

    documentGrid.style.display = "none";

    return;

  }

  documentGrid.style.display = "grid";

  filteredDocuments.forEach(documentData => {

    const iconData = getDocumentIcon(documentData);

    const card = document.createElement("article");

    card.className = "document-card";

    card.dataset.id = documentData.id;

    const top = document.createElement("div");

    top.className = "document-top";

    const icon = document.createElement("div");

    icon.className =
      "document-icon " + iconData.className;

    icon.textContent = iconData.icon;

    const moreButton = document.createElement("button");

    moreButton.className = "document-more";

    moreButton.textContent = "⋯";

    moreButton.setAttribute(
      "aria-label",
      "Open document options"
    );

    moreButton.addEventListener("click", event => {

      event.stopPropagation();

      openDocumentPreview(documentData.id);

    });

    top.append(icon, moreButton);

    const title = document.createElement("h4");

    title.textContent = documentData.name;

    const meta = document.createElement("div");

    meta.className = "document-meta";

    const size = document.createElement("span");

    size.textContent = formatFileSize(
      documentData.fileSize
    );

    const date = document.createElement("span");

    date.textContent = formatDate(
      documentData.createdAt
    );

    meta.append(size, date);

    const category = document.createElement("div");

    category.className = "document-category";

    category.textContent = documentData.category;

    card.append(
      top,
      title,
      meta,
      category
    );

    if (documentData.expiryDate) {

      const expiry = document.createElement("div");

      expiry.className = "document-expiry";

      expiry.textContent =
        "Expires: " + formatDate(
          new Date(documentData.expiryDate).getTime()
        );

      card.append(expiry);

    }

    card.addEventListener("click", () => {

      openDocumentPreview(documentData.id);

    });

    documentGrid.append(card);

  });

}

/* =========================
   CATEGORY FILTER
========================= */

document.querySelectorAll(".category-card").forEach(button => {

  button.addEventListener("click", () => {

    selectedCategory = button.dataset.category;

    document.querySelectorAll(".category-card").forEach(card => {

      card.classList.remove("active");

    });

    button.classList.add("active");

    document.getElementById("documentsHeading").textContent =
      selectedCategory === "All"
        ? "My Documents"
        : selectedCategory + " Documents";

    renderDocuments();

  });

});

function updateCategoryCounts() {

  const count = category => {

    if (category === "All") {

      return documents.length;

    }

    return documents.filter(
      documentData => documentData.category === category
    ).length;

  };

  document.getElementById("allCount").textContent =
    count("All");

  document.getElementById("identityCount").textContent =
    count("Identity");

  document.getElementById("financeCount").textContent =
    count("Finance");

  document.getElementById("educationCount").textContent =
    count("Education");

  document.getElementById("otherCount").textContent =
    count("Other");

}

/* =========================
   SEARCH
========================= */

searchInput.addEventListener("input", () => {

  renderDocuments();

});

/* =========================
   SORT
========================= */

document.getElementById("sortBtn").addEventListener(
  "click",
  event => {

    sortNewestFirst = !sortNewestFirst;

    event.currentTarget.textContent =
      sortNewestFirst
        ? "Recent ↓"
        : "Oldest ↑";

    renderDocuments();

  }
);

/* =========================
   DOCUMENT PREVIEW
========================= */

async function openDocumentPreview(id) {

  const documentData = documents.find(
    item => item.id === id
  );

  if (!documentData) {

    showToast("Document not found");

    return;

  }

  selectedDocumentId = id;

  previewTitle.textContent = documentData.name;

  previewInfo.textContent =
    documentData.category +
    " • " +
    formatFileSize(documentData.fileSize) +
    (documentData.backBlob ? " • Front + Back" : "");

  previewContent.innerHTML = "";

  previewContent.classList.toggle(
    "has-back",
    Boolean(documentData.backBlob)
  );

  const blobUrl = URL.createObjectURL(
    documentData.fileBlob
  );

  if (documentData.fileType === "application/pdf") {

    const iframe = document.createElement("iframe");

    iframe.src = blobUrl;

    iframe.title = documentData.name;

    previewContent.append(iframe);

  }

  else if (documentData.fileType.startsWith("image/")) {

    const image = document.createElement("img");

    image.src = blobUrl;

    image.alt = documentData.name;

    previewContent.append(image);

  }

  else {

    const placeholder = document.createElement("div");

    placeholder.className = "preview-file-placeholder";

    placeholder.textContent =
      "Preview is not available for this file.";

    previewContent.append(placeholder);

  }

  if (documentData.backBlob) {

    const backImage = document.createElement("img");

    backImage.src = URL.createObjectURL(documentData.backBlob);

    backImage.alt = documentData.name + " (back)";

    previewContent.append(backImage);

  }

  openModal("previewModal");

  document.getElementById("downloadDocumentBtn").onclick =
    () => downloadDocument(documentData);

  document.getElementById("pdfDocumentBtn").onclick =
    () => createPdfForDocument(documentData);

  document.getElementById("shareDocumentBtn").onclick =
    () => startShare(documentData);

  document.getElementById("deleteDocumentBtn").onclick =
    () => deleteDocument(documentData.id);

}

/* =========================
   DOWNLOAD DOCUMENT
========================= */

async function downloadDocument(documentData) {

  try {

    const path = await saveFileToDevice(
      documentData.fileBlob,
      documentData.fileName,
      documentData.fileType
    );

    if (documentData.backBlob) {

      const dot = documentData.fileName.lastIndexOf(".");

      const backName = dot > 0
        ? documentData.fileName.slice(0, dot) + "_back" +
          documentData.fileName.slice(dot)
        : documentData.fileName + "_back";

      await saveFileToDevice(
        documentData.backBlob,
        backName,
        documentData.backBlob.type || "image/jpeg"
      );

    }

    showToast("Saved: " + path, 4000);

  } catch (error) {

    if (isCancelledError(error)) return;

    console.error(error);

    showToast("Could not save the file");

  }

}

/* =========================
   DELETE DOCUMENT
========================= */

async function deleteDocument(id) {

  const confirmed = confirm(
    "Are you sure you want to delete this document?"
  );

  if (!confirmed) return;

  try {

    await deleteDocumentFromDatabase(id);

    closeModal("previewModal");

    await loadDocuments();

    showToast("Document deleted");

  } catch (error) {

    console.error(error);

    showToast("Could not delete document");

  }

}

/* =========================
   MODALS
========================= */

function openModal(id) {

  document.getElementById(id).classList.remove("hidden");

}

function closeModal(id) {

  document.getElementById(id).classList.add("hidden");

}

document.querySelectorAll("[data-close]").forEach(button => {

  button.addEventListener("click", () => {

    closeModal(button.dataset.close);

  });

});

/* =========================
   SETTINGS
========================= */

document.getElementById("settingsBtn").addEventListener(
  "click",
  () => {

    openModal("settingsModal");

  }
);

document.getElementById("allDocumentsBtn").addEventListener(
  "click",
  () => {

    selectedCategory = "All";

    document.querySelectorAll(".category-card").forEach(card => {

      card.classList.toggle(
        "active",
        card.dataset.category === "All"
      );

    });

    document.getElementById("documentsHeading").textContent =
      "My Documents";

    renderDocuments();

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

  }
);

document.getElementById("changePinBtn").addEventListener(
  "click",
  () => {

    closeModal("settingsModal");

    isChangingPin = true;

    firstPin = "";

    setPinScreen("change");

    mainApp.classList.add("hidden");

    lockScreen.classList.remove("hidden");

  }
);

/* =========================
   TOAST MESSAGE
========================= */

function showToast(message, duration = 2500) {

  toast.textContent = message;

  toast.classList.add("show");

  setTimeout(() => {

    toast.classList.remove("show");

  }, duration);

}

/* =========================
   NATIVE BRIDGE (ANDROID)
========================= */

const VaultNative = registerPlugin("VaultNative");

const isNative = Capacitor.isNativePlatform();

function clamp(value, min, max) {

  return Math.min(Math.max(value, min), max);

}

function safeFileName(name) {

  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim();

  return cleaned || "document";

}

function blobToBase64(blob) {

  return new Promise((resolve, reject) => {

    const reader = new FileReader();

    reader.onload = () => {

      resolve(String(reader.result).split(",")[1] || "");

    };

    reader.onerror = () => reject(reader.error);

    reader.readAsDataURL(blob);

  });

}

function base64ToBytes(base64) {

  const binary = atob(base64);

  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {

    bytes[i] = binary.charCodeAt(i);

  }

  return bytes;

}

function loadImageFromBlob(blob) {

  return new Promise((resolve, reject) => {

    const url = URL.createObjectURL(blob);

    const img = new Image();

    img.onload = () => resolve({ img, url });

    img.onerror = () => {

      URL.revokeObjectURL(url);

      reject(new Error("Image could not be loaded"));

    };

    img.src = url;

  });

}

/* Saves a file to Downloads/VaultX on Android.
   In a normal browser it falls back to a download link. */

async function saveFileToDevice(blob, fileName, mimeType) {

  if (isNative) {

    const data = await blobToBase64(blob);

    await withoutAutoLock(() => VaultNative.saveFileAs({
      fileName,
      mimeType,
      data
    }));

    return fileName;

  }

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;

  link.download = fileName;

  document.body.append(link);

  link.click();

  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return fileName;

}

/* =========================
   PDF CREATION
========================= */

async function imageBlobToJpeg(blob, maxSide = 2400) {

  const { img, url } = await loadImageFromBlob(blob);

  const scale = Math.min(
    1,
    maxSide / Math.max(img.naturalWidth, img.naturalHeight)
  );

  const width = Math.round(img.naturalWidth * scale);

  const height = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement("canvas");

  canvas.width = width;

  canvas.height = height;

  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";

  ctx.fillRect(0, 0, width, height);

  ctx.drawImage(img, 0, 0, width, height);

  URL.revokeObjectURL(url);

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.9),
    width,
    height
  };

}

function placeImageInBox(pdf, image, x, y, boxW, boxH) {

  const ratio = Math.min(
    boxW / image.width,
    boxH / image.height
  );

  const w = image.width * ratio;

  const h = image.height * ratio;

  pdf.addImage(
    image.dataUrl,
    "JPEG",
    x + (boxW - w) / 2,
    y + (boxH - h) / 2,
    w,
    h
  );

}

async function buildPdfFromDocument(documentData) {

  const front = await imageBlobToJpeg(documentData.fileBlob);

  const back = documentData.backBlob
    ? await imageBlobToJpeg(documentData.backBlob)
    : null;

  const pdf = new jsPDF({
    unit: "mm",
    format: "a4",
    orientation: "portrait"
  });

  const PAGE_W = 210;
  const PAGE_H = 297;
  const MARGIN = 12;

  const isCardShape = image => image.width / image.height > 1.2;

  if (back && isCardShape(front) && isCardShape(back)) {

    /* Card-like documents (Aadhaar, PAN, licence):
       front and back together on one page. */

    const boxW = 150;

    const boxH = (PAGE_H - MARGIN * 3) / 2;

    const x = (PAGE_W - boxW) / 2;

    placeImageInBox(pdf, front, x, MARGIN, boxW, boxH);

    placeImageInBox(pdf, back, x, MARGIN * 2 + boxH, boxW, boxH);

  } else {

    const pages = back ? [front, back] : [front];

    pages.forEach((image, index) => {

      if (index > 0) {

        pdf.addPage("a4", "portrait");

      }

      placeImageInBox(
        pdf,
        image,
        MARGIN,
        MARGIN,
        PAGE_W - MARGIN * 2,
        PAGE_H - MARGIN * 2
      );

    });

  }

  return pdf.output("blob");

}

async function createPdfForDocument(documentData) {

  showToast("Creating PDF...");

  try {

    let pdfBlob;

    if (documentData.fileType === "application/pdf") {

      pdfBlob = documentData.fileBlob;

    } else {

      pdfBlob = await buildPdfFromDocument(documentData);

    }

    const pdfName = safeFileName(documentData.name) + ".pdf";

    let savedWhere;

    if (isNative) {

      const saved = await VaultNative.saveToDownloads({
        fileName: pdfName,
        mimeType: "application/pdf",
        data: await blobToBase64(pdfBlob)
      });

      savedWhere = saved.path;

    } else {

      savedWhere = await saveFileToDevice(
        pdfBlob,
        pdfName,
        "application/pdf"
      );

    }

    showToast("PDF saved in " + savedWhere, 5000);

  } catch (error) {

    if (isCancelledError(error)) return;

    console.error(error);

    showToast("Could not create PDF");

  }

}

/* =========================
   DOCUMENT SCANNER (CAMERA)
========================= */

const scanFrontBtn = document.getElementById("scanFrontBtn");
const scanBackBtn = document.getElementById("scanBackBtn");
const scanCameraInput = document.getElementById("scanCameraInput");

let scanFrontBlob = null;
let scanBackBlob = null;

let scanFrontUrl = null;
let scanBackUrl = null;

let scanTargetSide = "front";

let pickedImageBlob = null;
let pickedImageName = "";

function updateScanSlots() {

  const setSlot = (button, textId, blob, url, label) => {

    const text = document.getElementById(textId);

    if (blob) {

      button.classList.add("done");

      button.style.backgroundImage = "url(" + url + ")";

      text.textContent = label + " ✓ Tap to retake";

    } else {

      button.classList.remove("done");

      button.style.backgroundImage = "";

      text.textContent = label === "Front"
        ? "Scan Front"
        : "Scan Back (optional)";

    }

  };

  setSlot(scanFrontBtn, "scanFrontText", scanFrontBlob, scanFrontUrl, "Front");

  setSlot(scanBackBtn, "scanBackText", scanBackBlob, scanBackUrl, "Back");

}

function resetScanState() {

  if (scanFrontUrl) URL.revokeObjectURL(scanFrontUrl);

  if (scanBackUrl) URL.revokeObjectURL(scanBackUrl);

  scanFrontBlob = null;
  scanBackBlob = null;
  scanFrontUrl = null;
  scanBackUrl = null;

  pickedImageBlob = null;
  pickedImageName = "";

  updateScanSlots();

}

async function startScan(side) {

  scanTargetSide = side;

  if (isNative) {

    try {

      const photo = await withoutAutoLock(() => Camera.getPhoto({
        source: CameraSource.Prompt,
        resultType: CameraResultType.Uri,
        quality: 95,
        correctOrientation: true,
        saveToGallery: false,
        promptLabelHeader: "Scan Document",
        promptLabelPicture: "Take Photo",
        promptLabelPhoto: "From Gallery",
        promptLabelCancel: "Cancel"
      }));

      const response = await fetch(photo.webPath);

      const blob = await response.blob();

      await openCropper(blob, side);

    } catch (error) {

      const message = String(error && error.message);

      if (/cancel/i.test(message)) return;

      console.error(error);

      if (/denied/i.test(message)) {

        showToast(
          "Camera permission is off. Turn it on in phone Settings > Apps > VaultX > Permissions.",
          5000
        );

      } else {

        showToast("Camera could not open", 4000);

      }

    }

    return;

  }

  scanCameraInput.value = "";

  scanCameraInput.click();

}

scanFrontBtn.addEventListener("click", () => startScan("front"));

scanBackBtn.addEventListener("click", () => startScan("back"));

scanCameraInput.addEventListener("change", () => {

  const file = scanCameraInput.files[0];

  if (!file) return;

  openCropper(file, scanTargetSide);

});

/* =========================
   MANUAL CROP
========================= */

const cropStage = document.getElementById("cropStage");
const cropCanvas = document.getElementById("cropCanvas");
const cropCtx = cropCanvas.getContext("2d");

const CROP_HANDLE_RADIUS = 24;
const CROP_MIN_SIZE = 40;
const CROP_MAX_SOURCE = 3000;

let cropSource = null;
let cropSide = "front";
let cropScale = 1;
let cropRect = { x: 0, y: 0, w: 0, h: 0 };
let cropDrag = null;

async function openCropper(file, side) {

  try {

    const { img, url } = await loadImageFromBlob(file);

    const scale = Math.min(
      1,
      CROP_MAX_SOURCE / Math.max(img.naturalWidth, img.naturalHeight)
    );

    cropSource = document.createElement("canvas");

    cropSource.width = Math.round(img.naturalWidth * scale);

    cropSource.height = Math.round(img.naturalHeight * scale);

    cropSource.getContext("2d").drawImage(
      img,
      0,
      0,
      cropSource.width,
      cropSource.height
    );

    URL.revokeObjectURL(url);

    cropSide = side;

    document.getElementById("cropTitle").textContent =
      side === "front"
        ? "Crop Front Side"
        : side === "back"
          ? "Crop Back Side"
          : "Crop Photo";

    openModal("cropModal");

    requestAnimationFrame(() => layoutCropper(true));

  } catch (error) {

    console.error(error);

    showToast("Could not open the photo");

  }

}

function layoutCropper(resetRect) {

  if (!cropSource) return;

  const maxW = cropStage.clientWidth || 320;

  const maxH = Math.round(window.innerHeight * 0.5);

  cropScale = Math.min(
    maxW / cropSource.width,
    maxH / cropSource.height
  );

  cropCanvas.width = Math.round(cropSource.width * cropScale);

  cropCanvas.height = Math.round(cropSource.height * cropScale);

  if (resetRect) {

    const marginX = cropCanvas.width * 0.06;

    const marginY = cropCanvas.height * 0.06;

    cropRect = {
      x: marginX,
      y: marginY,
      w: cropCanvas.width - marginX * 2,
      h: cropCanvas.height - marginY * 2
    };

  }

  drawCropper();

}

function drawCropper() {

  if (!cropSource) return;

  const W = cropCanvas.width;
  const H = cropCanvas.height;

  const { x, y, w, h } = cropRect;

  cropCtx.clearRect(0, 0, W, H);

  cropCtx.drawImage(cropSource, 0, 0, W, H);

  cropCtx.fillStyle = "rgba(0, 0, 0, 0.55)";

  cropCtx.fillRect(0, 0, W, y);

  cropCtx.fillRect(0, y + h, W, H - y - h);

  cropCtx.fillRect(0, y, x, h);

  cropCtx.fillRect(x + w, y, W - x - w, h);

  cropCtx.strokeStyle = "#9caaff";

  cropCtx.lineWidth = 2;

  cropCtx.strokeRect(x, y, w, h);

  cropCtx.strokeStyle = "rgba(255, 255, 255, 0.25)";

  cropCtx.lineWidth = 1;

  cropCtx.beginPath();

  for (let i = 1; i < 3; i++) {

    cropCtx.moveTo(x + (w / 3) * i, y);
    cropCtx.lineTo(x + (w / 3) * i, y + h);

    cropCtx.moveTo(x, y + (h / 3) * i);
    cropCtx.lineTo(x + w, y + (h / 3) * i);

  }

  cropCtx.stroke();

  [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h]
  ].forEach(([cx, cy]) => {

    cropCtx.beginPath();

    cropCtx.arc(cx, cy, 10, 0, Math.PI * 2);

    cropCtx.fillStyle = "#ffffff";

    cropCtx.fill();

    cropCtx.lineWidth = 3;

    cropCtx.strokeStyle = "#7c8cff";

    cropCtx.stroke();

  });

}

function getCropPoint(event) {

  const box = cropCanvas.getBoundingClientRect();

  return {
    x: (event.clientX - box.left) * (cropCanvas.width / box.width),
    y: (event.clientY - box.top) * (cropCanvas.height / box.height)
  };

}

cropCanvas.addEventListener("pointerdown", event => {

  const point = getCropPoint(event);

  const { x, y, w, h } = cropRect;

  const corners = {
    tl: [x, y],
    tr: [x + w, y],
    bl: [x, y + h],
    br: [x + w, y + h]
  };

  let mode = null;

  for (const [name, [cx, cy]] of Object.entries(corners)) {

    if (Math.hypot(point.x - cx, point.y - cy) <= CROP_HANDLE_RADIUS) {

      mode = name;

      break;

    }

  }

  if (
    !mode &&
    point.x > x && point.x < x + w &&
    point.y > y && point.y < y + h
  ) {

    mode = "move";

  }

  if (!mode) return;

  cropDrag = {
    mode,
    start: point,
    rect: { ...cropRect }
  };

  cropCanvas.setPointerCapture(event.pointerId);

  event.preventDefault();

});

cropCanvas.addEventListener("pointermove", event => {

  if (!cropDrag) return;

  const point = getCropPoint(event);

  const dx = point.x - cropDrag.start.x;

  const dy = point.y - cropDrag.start.y;

  const start = cropDrag.rect;

  const W = cropCanvas.width;

  const H = cropCanvas.height;

  if (cropDrag.mode === "move") {

    cropRect = {
      x: clamp(start.x + dx, 0, W - start.w),
      y: clamp(start.y + dy, 0, H - start.h),
      w: start.w,
      h: start.h
    };

  } else {

    let left = start.x;
    let top = start.y;
    let right = start.x + start.w;
    let bottom = start.y + start.h;

    if (cropDrag.mode.includes("l")) {
      left = clamp(start.x + dx, 0, right - CROP_MIN_SIZE);
    }

    if (cropDrag.mode.includes("r")) {
      right = clamp(start.x + start.w + dx, left + CROP_MIN_SIZE, W);
    }

    if (cropDrag.mode.includes("t")) {
      top = clamp(start.y + dy, 0, bottom - CROP_MIN_SIZE);
    }

    if (cropDrag.mode.includes("b")) {
      bottom = clamp(start.y + start.h + dy, top + CROP_MIN_SIZE, H);
    }

    cropRect = {
      x: left,
      y: top,
      w: right - left,
      h: bottom - top
    };

  }

  drawCropper();

});

["pointerup", "pointercancel"].forEach(eventName => {

  cropCanvas.addEventListener(eventName, () => {

    cropDrag = null;

  });

});

function closeCropper() {

  closeModal("cropModal");

  cropSource = null;

  cropDrag = null;

}

document.getElementById("cropCancelBtn").addEventListener(
  "click",
  closeCropper
);

document.getElementById("cropResetBtn").addEventListener(
  "click",
  () => layoutCropper(true)
);

document.getElementById("cropRotateBtn").addEventListener(
  "click",
  () => {

    if (!cropSource) return;

    const rotated = document.createElement("canvas");

    rotated.width = cropSource.height;

    rotated.height = cropSource.width;

    const ctx = rotated.getContext("2d");

    ctx.translate(rotated.width / 2, rotated.height / 2);

    ctx.rotate(Math.PI / 2);

    ctx.drawImage(
      cropSource,
      -cropSource.width / 2,
      -cropSource.height / 2
    );

    cropSource = rotated;

    layoutCropper(true);

  }
);

document.getElementById("cropDoneBtn").addEventListener(
  "click",
  async () => {

    if (!cropSource) return;

    const ratioX = cropSource.width / cropCanvas.width;

    const ratioY = cropSource.height / cropCanvas.height;

    const sx = cropRect.x * ratioX;
    const sy = cropRect.y * ratioY;
    const sw = cropRect.w * ratioX;
    const sh = cropRect.h * ratioY;

    const output = document.createElement("canvas");

    output.width = Math.max(1, Math.round(sw));

    output.height = Math.max(1, Math.round(sh));

    output.getContext("2d").drawImage(
      cropSource,
      sx, sy, sw, sh,
      0, 0, output.width, output.height
    );

    const blob = await new Promise(resolve => {

      output.toBlob(resolve, "image/jpeg", 0.92);

    });

    if (!blob) {

      showToast("Could not crop the photo");

      return;

    }

    if (cropSide === "file") {

      const original = documentFileInput.files[0];

      const baseName = original
        ? original.name.replace(/\.[^/.]+$/, "")
        : "photo";

      pickedImageBlob = blob;

      pickedImageName = baseName + ".jpg";

      filePickerText.textContent = pickedImageName + " (cropped)";

    } else if (cropSide === "front") {

      if (scanFrontUrl) URL.revokeObjectURL(scanFrontUrl);

      scanFrontBlob = blob;

      scanFrontUrl = URL.createObjectURL(blob);

    } else {

      if (scanBackUrl) URL.revokeObjectURL(scanBackUrl);

      scanBackBlob = blob;

      scanBackUrl = URL.createObjectURL(blob);

    }

    closeCropper();

    updateScanSlots();

  }
);

window.addEventListener("resize", () => {

  if (cropSource) layoutCropper(true);

});

/* =========================
   ADD BUTTON (FLOATING)
========================= */

function handleAddClick() {

  try {

    openAddDocumentModal();

  } catch (error) {

    console.error(error);

    showToast("Could not open Add Document: " + error.message, 6000);

  }

}

["fabAddBtn", "headerAddBtn"].forEach(id => {

  const button = document.getElementById(id);

  if (button) {

    button.addEventListener("click", handleAddClick);

  }

});

/* =========================
   ENCRYPTED BACKUP
========================= */

const BACKUP_MAGIC = "VXB1";
const PBKDF2_ITERATIONS = 250000;
const MIN_BACKUP_PASSWORD = 6;

const backupPasswordInput = document.getElementById("backupPassword");
const backupPasswordConfirm = document.getElementById("backupPasswordConfirm");
const confirmPasswordWrap = document.getElementById("confirmPasswordWrap");
const passwordMessage = document.getElementById("passwordMessage");

let passwordAction = null;
let pendingBackupFolder = null;
let pendingRestoreBytes = null;

async function deriveBackupKey(password, salt) {

  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

}

async function buildBackupPlaintext() {

  const allDocuments = await getAllDocumentsFromDatabase();

  const header = {
    version: 1,
    createdAt: Date.now(),
    documents: []
  };

  const chunks = [];

  for (const item of allDocuments) {

    const entry = {
      id: item.id,
      name: item.name,
      category: item.category,
      expiryDate: item.expiryDate || "",
      fileName: item.fileName,
      fileType: item.fileType,
      fileSize: item.fileSize,
      createdAt: item.createdAt,
      frontLength: 0,
      backLength: 0,
      backType: null
    };

    const frontBytes = new Uint8Array(
      await item.fileBlob.arrayBuffer()
    );

    entry.frontLength = frontBytes.length;

    chunks.push(frontBytes);

    if (item.backBlob) {

      const backBytes = new Uint8Array(
        await item.backBlob.arrayBuffer()
      );

      entry.backLength = backBytes.length;

      entry.backType = item.backBlob.type || "image/jpeg";

      chunks.push(backBytes);

    }

    header.documents.push(entry);

  }

  const headerBytes = new TextEncoder().encode(
    JSON.stringify(header)
  );

  const total = chunks.reduce(
    (sum, chunk) => sum + chunk.length,
    4 + headerBytes.length
  );

  const output = new Uint8Array(total);

  new DataView(output.buffer).setUint32(0, headerBytes.length);

  output.set(headerBytes, 4);

  let offset = 4 + headerBytes.length;

  for (const chunk of chunks) {

    output.set(chunk, offset);

    offset += chunk.length;

  }

  return output;

}

async function encryptBackup(plain, password) {

  const salt = crypto.getRandomValues(new Uint8Array(16));

  const iv = crypto.getRandomValues(new Uint8Array(12));

  const key = await deriveBackupKey(password, salt);

  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      plain
    )
  );

  const magic = new TextEncoder().encode(BACKUP_MAGIC);

  const output = new Uint8Array(4 + 16 + 12 + cipher.length);

  output.set(magic, 0);
  output.set(salt, 4);
  output.set(iv, 20);
  output.set(cipher, 32);

  return output;

}

async function decryptBackup(bytes, password) {

  if (
    bytes.length < 33 ||
    new TextDecoder().decode(bytes.slice(0, 4)) !== BACKUP_MAGIC
  ) {

    throw new Error("NOT_A_BACKUP");

  }

  const salt = bytes.slice(4, 20);

  const iv = bytes.slice(20, 32);

  const cipher = bytes.slice(32);

  const key = await deriveBackupKey(password, salt);

  try {

    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        cipher
      )
    );

  } catch (error) {

    throw new Error("WRONG_PASSWORD");

  }

}

function parseBackupPlaintext(plain) {

  const view = new DataView(
    plain.buffer,
    plain.byteOffset,
    plain.byteLength
  );

  const headerLength = view.getUint32(0);

  const header = JSON.parse(
    new TextDecoder().decode(plain.slice(4, 4 + headerLength))
  );

  let offset = 4 + headerLength;

  return header.documents.map(entry => {

    const frontBytes = plain.slice(offset, offset + entry.frontLength);

    offset += entry.frontLength;

    const restored = {
      id: entry.id,
      name: entry.name,
      category: entry.category,
      expiryDate: entry.expiryDate || "",
      fileName: entry.fileName,
      fileType: entry.fileType,
      fileSize: entry.fileSize,
      createdAt: entry.createdAt,
      fileBlob: new Blob([frontBytes], { type: entry.fileType })
    };

    if (entry.backLength > 0) {

      const backBytes = plain.slice(offset, offset + entry.backLength);

      offset += entry.backLength;

      restored.backBlob = new Blob(
        [backBytes],
        { type: entry.backType || "image/jpeg" }
      );

    }

    return restored;

  });

}

function openPasswordModal(action) {

  passwordAction = action;

  backupPasswordInput.value = "";

  backupPasswordConfirm.value = "";

  passwordMessage.textContent = "";

  const isBackup = action === "backup";

  document.getElementById("passwordTitle").textContent =
    isBackup ? "Backup Password" : "Restore Backup";

  document.getElementById("passwordInfo").textContent = isBackup
    ? "Choose a password. If you forget it, the backup cannot be opened."
    : "Enter the password you used when creating this backup.";

  document.getElementById("passwordConfirmBtn").textContent =
    isBackup ? "Create Encrypted Backup" : "Restore Documents";

  confirmPasswordWrap.classList.toggle("hidden", !isBackup);

  openModal("passwordModal");

}

function backupFileName() {

  const now = new Date();

  const pad = number => String(number).padStart(2, "0");

  return "VaultX_Backup_" +
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) + "_" +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    ".vxbackup";

}

function isCancelledError(error) {

  return /cancel/i.test(String(error && error.message));

}

document.getElementById("backupBtn").addEventListener(
  "click",
  async () => {

    if (documents.length === 0) {

      showToast("No documents to back up yet");

      return;

    }

    try {

      if (isNative) {

        showToast("Choose the folder for your backup");

        pendingBackupFolder = await withoutAutoLock(
          () => VaultNative.chooseBackupFolder()
        );

      } else {

        pendingBackupFolder = null;

      }

      openPasswordModal("backup");

    } catch (error) {

      if (!isCancelledError(error)) {

        console.error(error);

        showToast("Could not open the folder picker");

      }

    }

  }
);

document.getElementById("restoreBtn").addEventListener(
  "click",
  async () => {

    if (!isNative) {

      showToast("Restore works in the Android app");

      return;

    }

    try {

      const picked = await withoutAutoLock(
        () => VaultNative.pickBackupFile()
      );

      const result = await VaultNative.readBackup({
        fileUri: picked.uri
      });

      pendingRestoreBytes = base64ToBytes(result.data);

      openPasswordModal("restore");

    } catch (error) {

      if (!isCancelledError(error)) {

        console.error(error);

        showToast("Could not read the backup file");

      }

    }

  }
);

document.getElementById("passwordConfirmBtn").addEventListener(
  "click",
  async () => {

    const password = backupPasswordInput.value;

    passwordMessage.textContent = "";

    if (password.length < MIN_BACKUP_PASSWORD) {

      passwordMessage.textContent =
        "Password must be at least " + MIN_BACKUP_PASSWORD + " characters.";

      return;

    }

    if (passwordAction === "backup") {

      if (password !== backupPasswordConfirm.value) {

        passwordMessage.textContent = "Passwords do not match.";

        return;

      }

      closeModal("passwordModal");

      await runBackup(password);

      return;

    }

    if (passwordAction === "restore") {

      closeModal("passwordModal");

      await runRestore(password);

    }

  }
);

async function runBackup(password) {

  try {

    showToast("Encrypting backup...");

    const plain = await buildBackupPlaintext();

    const encrypted = await encryptBackup(plain, password);

    const fileName = backupFileName();

    const encryptedBlob = new Blob(
      [encrypted],
      { type: "application/octet-stream" }
    );

    if (isNative && pendingBackupFolder) {

      await VaultNative.saveBackup({
        folderUri: pendingBackupFolder.uri,
        fileName,
        data: await blobToBase64(encryptedBlob)
      });

      showToast(
        "Backup saved in " +
        (pendingBackupFolder.name || "the selected folder")
      );

    } else {

      await saveFileToDevice(
        encryptedBlob,
        fileName,
        "application/octet-stream"
      );

      showToast("Backup saved");

    }

  } catch (error) {

    console.error(error);

    showToast("Backup failed. Please try again.");

  } finally {

    pendingBackupFolder = null;

  }

}

async function runRestore(password) {

  try {

    showToast("Decrypting backup...");

    const plain = await decryptBackup(pendingRestoreBytes, password);

    const restoredDocuments = parseBackupPlaintext(plain);

    for (const item of restoredDocuments) {

      await saveDocumentToDatabase(item);

    }

    await loadDocuments();

    showToast(
      restoredDocuments.length + " document(s) restored"
    );

    pendingRestoreBytes = null;

  } catch (error) {

    console.error(error);

    if (error.message === "WRONG_PASSWORD") {

      showToast("Wrong password. Please try again.");

      openPasswordModal("restore");

    } else if (error.message === "NOT_A_BACKUP") {

      pendingRestoreBytes = null;

      showToast("This is not a VaultX backup file");

    } else {

      pendingRestoreBytes = null;

      showToast("Restore failed");

    }

  }

}

/* =========================
   CROP A PICKED IMAGE
========================= */

documentFileInput.addEventListener("change", () => {

  const file = documentFileInput.files[0];

  pickedImageBlob = null;

  pickedImageName = "";

  if (file && file.type.startsWith("image/")) {

    openCropper(file, "file");

  }

});

document.getElementById("cropSkipBtn").addEventListener(
  "click",
  () => {

    if (!cropSource) return;

    cropRect = {
      x: 0,
      y: 0,
      w: cropCanvas.width,
      h: cropCanvas.height
    };

    document.getElementById("cropDoneBtn").click();

  }
);

/* =========================
   SHARE
========================= */

let shareTarget = null;

async function cleanupShareCache() {

  if (!isNative) return;

  try {

    await Filesystem.rmdir({
      path: "share",
      directory: Directory.Cache,
      recursive: true
    });

  } catch (error) {

    /* nothing to clean */

  }

}

function startShare(documentData) {

  if (documentData.fileType === "application/pdf") {

    shareDocument(documentData, "pdf");

    return;

  }

  shareTarget = documentData;

  openModal("shareModal");

}

document.getElementById("shareAsPdfBtn").addEventListener(
  "click",
  () => {

    closeModal("shareModal");

    if (shareTarget) shareDocument(shareTarget, "pdf");

  }
);

document.getElementById("shareAsImageBtn").addEventListener(
  "click",
  () => {

    closeModal("shareModal");

    if (shareTarget) shareDocument(shareTarget, "image");

  }
);

async function shareDocument(documentData, format) {

  showToast("Preparing to share...");

  try {

    const files = [];

    if (format === "pdf") {

      const pdfBlob = documentData.fileType === "application/pdf"
        ? documentData.fileBlob
        : await buildPdfFromDocument(documentData);

      files.push({
        blob: pdfBlob,
        name: safeFileName(documentData.name) + ".pdf",
        type: "application/pdf"
      });

    } else {

      files.push({
        blob: documentData.fileBlob,
        name: documentData.fileName,
        type: documentData.fileType
      });

      if (documentData.backBlob) {

        const dot = documentData.fileName.lastIndexOf(".");

        files.push({
          blob: documentData.backBlob,
          name: dot > 0
            ? documentData.fileName.slice(0, dot) + "_back" +
              documentData.fileName.slice(dot)
            : documentData.fileName + "_back",
          type: documentData.backBlob.type || "image/jpeg"
        });

      }

    }

    if (!isNative) {

      const webFiles = files.map(
        item => new File([item.blob], item.name, { type: item.type })
      );

      if (navigator.canShare && navigator.canShare({ files: webFiles })) {

        await navigator.share({
          files: webFiles,
          title: documentData.name
        });

      } else {

        showToast("Sharing works in the Android app");

      }

      return;

    }

    const uris = [];

    for (const item of files) {

      const written = await Filesystem.writeFile({
        path: "share/" + Date.now() + "_" + safeFileName(item.name),
        data: await blobToBase64(item.blob),
        directory: Directory.Cache,
        recursive: true
      });

      uris.push(written.uri);

    }

    await withoutAutoLock(() => Share.share({
      title: documentData.name,
      dialogTitle: "Share document",
      files: uris
    }));

  } catch (error) {

    if (/cancel|dismiss/i.test(String(error && error.message))) return;

    console.error(error);

    showToast("Could not share the document");

  }

}

/* =========================
   AUTO LOCK (WHEN APP GOES TO BACKGROUND)
========================= */

let autoLockPaused = 0;

/* Camera, gallery, folder picker and Save dialogs leave the app
   for a moment. Those are wrapped here so they do not lock the vault. */

async function withoutAutoLock(task, holdMs = 1500) {

  autoLockPaused++;

  try {

    return await task();

  } finally {

    setTimeout(() => {

      autoLockPaused = Math.max(0, autoLockPaused - 1);

    }, holdMs);

  }

}

function closeAllModals() {

  document.querySelectorAll(".modal").forEach(modal => {

    modal.classList.add("hidden");

  });

  closeCropper();

  previewContent.innerHTML = "";

  resetScanState();

  backupPasswordInput.value = "";

  backupPasswordConfirm.value = "";

  pendingRestoreBytes = null;

  pendingBackupFolder = null;

  shareTarget = null;

}

function autoLockVault() {

  if (autoLockPaused > 0) return;

  if (mainApp.classList.contains("hidden")) return;

  closeAllModals();

  lockVault();

}

document.addEventListener("visibilitychange", () => {

  if (document.visibilityState === "hidden") {

    autoLockVault();

  }

});

if (isNative) {

  App.addListener("appStateChange", state => {

    if (!state.isActive) {

      autoLockVault();

    }

  });

}

/* =========================
   INITIALIZATION
========================= */

async function initializeVault() {

  try {

    await openDatabase();

    cleanupShareCache();

    const savedPin = getSavedPinHash();

    if (savedPin) {

      setPinScreen("unlock");

    } else {

      setPinScreen("setup");

    }

  } catch (error) {

    console.error(error);

    pinMessage.textContent =
      "Storage initialization failed.";

  }

}

initializeVault();
