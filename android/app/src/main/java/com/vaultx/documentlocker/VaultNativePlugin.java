package com.vaultx.documentlocker;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;

import androidx.activity.result.ActivityResult;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.Executor;

@CapacitorPlugin(name = "VaultNative")
public class VaultNativePlugin extends Plugin {

    private static final int AUTHENTICATORS =
            BiometricManager.Authenticators.BIOMETRIC_STRONG
            | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    @PluginMethod
    public void authenticate(PluginCall call) {
        androidx.fragment.app.FragmentActivity activity =
                (androidx.fragment.app.FragmentActivity) getActivity();

        BiometricManager manager = BiometricManager.from(activity);

        if (manager.canAuthenticate(AUTHENTICATORS)
                != BiometricManager.BIOMETRIC_SUCCESS) {
            call.reject("Biometric authentication is not available. Use PIN.");
            return;
        }

        Executor executor = ContextCompat.getMainExecutor(activity);

        BiometricPrompt prompt = new BiometricPrompt(
                activity,
                executor,
                new BiometricPrompt.AuthenticationCallback() {

                    @Override
                    public void onAuthenticationSucceeded(
                            @NonNull BiometricPrompt.AuthenticationResult result) {
                        JSObject response = new JSObject();
                        response.put("success", true);
                        call.resolve(response);
                    }

                    @Override
                    public void onAuthenticationFailed() {
                        // Fingerprint did not match.
                        // Android will allow another attempt.
                    }

                    @Override
                    public void onAuthenticationError(
                            int errorCode,
                            @NonNull CharSequence errString) {
                        call.reject(errString.toString());
                    }
                }
        );

        BiometricPrompt.PromptInfo promptInfo =
                new BiometricPrompt.PromptInfo.Builder()
                        .setTitle("Unlock VaultX")
                        .setSubtitle("Authenticate to access your documents")
                        .setAllowedAuthenticators(AUTHENTICATORS)
                        .build();

        prompt.authenticate(promptInfo);
    }

    @PluginMethod
    public void chooseBackupFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);

        intent.addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );

        startActivityForResult(
                call,
                intent,
                "folderResult"
        );
    }

    @ActivityCallback
    private void folderResult(
            PluginCall call,
            ActivityResult result) {

        if (result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null) {
            call.reject("Folder selection cancelled");
            return;
        }

        Uri uri = result.getData().getData();

        if (uri == null) {
            call.reject("Invalid folder");
            return;
        }

        int flags = result.getData().getFlags()
                & (Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);

        getContext().getContentResolver()
                .takePersistableUriPermission(uri, flags);

        JSObject response = new JSObject();
        response.put("uri", uri.toString());
        response.put("name", DocumentFile.fromTreeUri(
                getContext(), uri).getName());

        call.resolve(response);
    }

    @PluginMethod
    public void saveBackup(PluginCall call) {
        String folderUriString = call.getString("folderUri");
        String fileName = call.getString("fileName");
        String data = call.getString("data");

        if (folderUriString == null || fileName == null || data == null) {
            call.reject("Missing backup information");
            return;
        }

        try {
            Uri folderUri = Uri.parse(folderUriString);

            DocumentFile folder =
                    DocumentFile.fromTreeUri(getContext(), folderUri);

            if (folder == null || !folder.canWrite()) {
                call.reject("Selected folder is not writable");
                return;
            }

            DocumentFile file = folder.createFile(
                    "application/octet-stream",
                    fileName
            );

            if (file == null) {
                call.reject("Could not create backup file");
                return;
            }

            OutputStream output = getContext()
                    .getContentResolver()
                    .openOutputStream(file.getUri());

            if (output == null) {
                call.reject("Could not open backup file");
                return;
            }

            output.write(android.util.Base64.decode(
                    data,
                    android.util.Base64.DEFAULT
            ));

            output.flush();
            output.close();

            JSObject response = new JSObject();
            response.put("success", true);
            response.put("uri", file.getUri().toString());

            call.resolve(response);

        } catch (Exception e) {
            call.reject("Backup failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void readBackup(PluginCall call) {
        String fileUriString = call.getString("fileUri");

        if (fileUriString == null) {
            call.reject("Backup file not selected");
            return;
        }

        try {
            Uri uri = Uri.parse(fileUriString);

            InputStream input = getContext()
                    .getContentResolver()
                    .openInputStream(uri);

            if (input == null) {
                call.reject("Could not open backup");
                return;
            }

            ByteArrayOutputStream output =
                    new ByteArrayOutputStream();

            byte[] buffer = new byte[8192];
            int length;

            while ((length = input.read(buffer)) != -1) {
                output.write(buffer, 0, length);
            }

            input.close();

            String base64 = android.util.Base64.encodeToString(
                    output.toByteArray(),
                    android.util.Base64.NO_WRAP
            );

            JSObject response = new JSObject();
            response.put("data", base64);

            call.resolve(response);

        } catch (Exception e) {
            call.reject("Restore read failed: " + e.getMessage());
        }
    }

    // ---------------------------------------------------------
    // Pick an existing encrypted backup file (for restore)
    // ---------------------------------------------------------
    @PluginMethod
    public void pickBackupFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");

        startActivityForResult(
                call,
                intent,
                "pickFileResult"
        );
    }

    @ActivityCallback
    private void pickFileResult(
            PluginCall call,
            ActivityResult result) {

        if (result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null
                || result.getData().getData() == null) {
            call.reject("File selection cancelled");
            return;
        }

        Uri uri = result.getData().getData();

        JSObject response = new JSObject();
        response.put("uri", uri.toString());

        call.resolve(response);
    }

    // ---------------------------------------------------------
    // Save a file (PDF / image) into the phone's Downloads/VaultX
    // ---------------------------------------------------------
    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType");
        String data = call.getString("data");

        if (fileName == null || data == null) {
            call.reject("Missing file information");
            return;
        }

        if (mimeType == null) {
            mimeType = "application/octet-stream";
        }

        try {
            byte[] bytes = android.util.Base64.decode(
                    data,
                    android.util.Base64.DEFAULT
            );

            String savedPath;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {

                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                values.put(
                        MediaStore.Downloads.RELATIVE_PATH,
                        Environment.DIRECTORY_DOWNLOADS + "/VaultX"
                );

                Uri uri = getContext().getContentResolver().insert(
                        MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                        values
                );

                if (uri == null) {
                    call.reject("Could not create file in Downloads");
                    return;
                }

                OutputStream output = getContext()
                        .getContentResolver()
                        .openOutputStream(uri);

                if (output == null) {
                    call.reject("Could not open file in Downloads");
                    return;
                }

                output.write(bytes);
                output.flush();
                output.close();

                savedPath = "Downloads/VaultX/" + fileName;

            } else {

                File folder = new File(
                        Environment.getExternalStoragePublicDirectory(
                                Environment.DIRECTORY_DOWNLOADS),
                        "VaultX"
                );

                if (!folder.exists() && !folder.mkdirs()) {
                    call.reject("Could not create Downloads/VaultX");
                    return;
                }

                File file = new File(folder, fileName);

                FileOutputStream output = new FileOutputStream(file);
                output.write(bytes);
                output.flush();
                output.close();

                savedPath = "Downloads/VaultX/" + fileName;
            }

            JSObject response = new JSObject();
            response.put("success", true);
            response.put("path", savedPath);

            call.resolve(response);

        } catch (Exception e) {
            call.reject("Save failed: " + e.getMessage());
        }
    }

    // ---------------------------------------------------------
    // "Save as" - the phone's own file dialog opens so the user
    // can pick the folder (Downloads, Documents, SD card, ...)
    // ---------------------------------------------------------
    @PluginMethod
    public void saveFileAs(PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType");
        String data = call.getString("data");

        if (fileName == null || data == null) {
            call.reject("Missing file information");
            return;
        }

        if (mimeType == null) {
            mimeType = "application/octet-stream";
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, fileName);

        startActivityForResult(
                call,
                intent,
                "saveFileResult"
        );
    }

    @ActivityCallback
    private void saveFileResult(
            PluginCall call,
            ActivityResult result) {

        if (call == null) {
            return;
        }

        if (result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null
                || result.getData().getData() == null) {
            call.reject("Save cancelled");
            return;
        }

        try {
            Uri uri = result.getData().getData();

            byte[] bytes = android.util.Base64.decode(
                    call.getString("data"),
                    android.util.Base64.DEFAULT
            );

            OutputStream output = getContext()
                    .getContentResolver()
                    .openOutputStream(uri);

            if (output == null) {
                call.reject("Could not open the selected location");
                return;
            }

            output.write(bytes);
            output.flush();
            output.close();

            JSObject response = new JSObject();
            response.put("success", true);
            response.put("uri", uri.toString());

            call.resolve(response);

        } catch (Exception e) {
            call.reject("Save failed: " + e.getMessage());
        }
    }
}
