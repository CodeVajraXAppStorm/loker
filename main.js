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

  const file = documentFileInput.files[0];

  addDocumentMessage.textContent = "";

  if (!name) {

    addDocumentMessage.textContent =
      "Please enter a document name.";

    return;

  }

  if (!file) {

    addDocumentMessage.textContent =
      "Please select a PDF or image.";

    return;

  }

  if (file.size > MAX_FILE_SIZE) {

    addDocumentMessage.textContent =
      "File is too large. Maximum size is 25 MB.";

    return;

  }

  const isPdf = file.type === "application/pdf";

  const isImage = file.type.startsWith("image/");

  if (!isPdf && !isImage) {

    addDocumentMessage.textContent =
      "Only PDF and image files are supported.";

    return;

  }

  const documentData = {

    id: crypto.randomUUID(),

    name,

    category,

    expiryDate,

    fileName: file.name,

    fileType: file.type,

    fileSize: file.size,

    fileBlob: file,

    createdAt: Date.now()

  };

  try {

    await saveDocumentToDatabase(documentData);

    closeModal("addModal");

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
    formatFileSize(documentData.fileSize);

  previewContent.innerHTML = "";

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

  openModal("previewModal");

  document.getElementById("downloadDocumentBtn").onclick =
    () => downloadDocument(documentData);

  document.getElementById("deleteDocumentBtn").onclick =
    () => deleteDocument(documentData.id);

}


/* =========================
   DOWNLOAD DOCUMENT
========================= */

function downloadDocument(documentData) {

  const url = URL.createObjectURL(
    documentData.fileBlob
  );

  const link = document.createElement("a");

  link.href = url;

  link.download = documentData.fileName;

  document.body.append(link);

  link.click();

  link.remove();

  setTimeout(() => {

    URL.revokeObjectURL(url);

  }, 1000);

  showToast("Download started");

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

function showToast(message) {

  toast.textContent = message;

  toast.classList.add("show");

  setTimeout(() => {

    toast.classList.remove("show");

  }, 2500);

}


/* =========================
   INITIALIZATION
========================= */

async function initializeVault() {

  try {

    await openDatabase();

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
