package com.orbit.securestore;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Orbit's secret storage on Android (mobile plan B4): the device keys, the identity key and the
 * install ID. Each value is encrypted with AES-256-GCM under a key that lives in the Android
 * Keystore (StrongBox when the device has one) and can't be exported; only the ciphertext is in
 * SharedPreferences. The store key name is the GCM associated data, so a ciphertext can't be
 * moved to another name. The app's manifest turns backups off, and Keystore keys never leave the
 * device anyway.
 *
 * Deliberately not built on androidx.security EncryptedSharedPreferences (deprecated).
 *
 * A value that exists but can't be decrypted is an error, never "not found": the app must not
 * generate a replacement device key over one it merely failed to read.
 */
@CapacitorPlugin(name = "SecureStore")
public class SecureStorePlugin extends Plugin {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "orbit_secure_store_v1";
    private static final String PREFS = "orbit_secure_store_v1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final int MAX_VALUE_CHARS = 64 * 1024;
    private static final Pattern KEY_PATTERN = Pattern.compile("^orbit:[A-Za-z0-9:_.-]{1,200}$");

    private final Object lock = new Object();

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey secretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        boolean strongBox =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
            getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE);
        try {
            generator.init(spec(strongBox));
            return generator.generateKey();
        } catch (Exception error) {
            if (!strongBox) throw error;
            // StrongBox is advertised but refused this key (StrongBoxUnavailableException): use the TEE.
            generator.init(spec(false));
            return generator.generateKey();
        }
    }

    private KeyGenParameterSpec spec(boolean strongBox) {
        KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true);
        if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) builder.setIsStrongBoxBacked(true);
        return builder.build();
    }

    private String validKey(PluginCall call) {
        String name = call.getString("key");
        if (name == null || !KEY_PATTERN.matcher(name).matches()) {
            call.reject("Invalid secure store key");
            return null;
        }
        return name;
    }

    @PluginMethod
    public void get(PluginCall call) {
        String name = validKey(call);
        if (name == null) return;
        synchronized (lock) {
            String stored = prefs().getString(name, null);
            JSObject result = new JSObject();
            if (stored == null) {
                result.put("value", JSObject.NULL);
                call.resolve(result);
                return;
            }
            try {
                byte[] blob = Base64.decode(stored, Base64.NO_WRAP);
                if (blob.length <= IV_BYTES) throw new IllegalStateException("truncated");
                ByteBuffer buffer = ByteBuffer.wrap(blob);
                byte[] iv = new byte[IV_BYTES];
                buffer.get(iv);
                byte[] ciphertext = new byte[buffer.remaining()];
                buffer.get(ciphertext);
                Cipher cipher = Cipher.getInstance(TRANSFORMATION);
                cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(TAG_BITS, iv));
                cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
                result.put("value", new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8));
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Secure store value can't be read", "locked", error);
            }
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String name = validKey(call);
        if (name == null) return;
        String value = call.getString("value");
        if (value == null || value.length() > MAX_VALUE_CHARS) {
            call.reject("Invalid secure store value");
            return;
        }
        synchronized (lock) {
            try {
                Cipher cipher = Cipher.getInstance(TRANSFORMATION);
                cipher.init(Cipher.ENCRYPT_MODE, secretKey());
                cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
                byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
                byte[] iv = cipher.getIV();
                ByteBuffer blob = ByteBuffer.allocate(iv.length + ciphertext.length);
                blob.put(iv);
                blob.put(ciphertext);
                // commit(), not apply(): the call resolves only once the value is on disk.
                if (!prefs().edit().putString(name, Base64.encodeToString(blob.array(), Base64.NO_WRAP)).commit()) {
                    call.reject("Secure store write failed");
                    return;
                }
                call.resolve();
            } catch (Exception error) {
                call.reject("Secure store write failed", error);
            }
        }
    }

    /**
     * Advisory root signs (mobile plan M5): a su binary on the usual paths, or a test-keys build.
     * Nothing is blocked on it; the app only warns. Any check can be fooled on a rooted device.
     */
    @PluginMethod
    public void deviceIntegrity(PluginCall call) {
        String[] suPaths = {
            "/system/app/Superuser.apk", "/sbin/su", "/system/bin/su", "/system/xbin/su", "/data/local/xbin/su",
            "/data/local/bin/su", "/system/sd/xbin/su", "/system/bin/failsafe/su", "/data/local/su", "/su/bin/su"
        };
        com.getcapacitor.JSArray reasons = new com.getcapacitor.JSArray();
        for (String path : suPaths) {
            if (new java.io.File(path).exists()) {
                reasons.put("su binary at " + path);
                break;
            }
        }
        String tags = Build.TAGS;
        if (tags != null && tags.contains("test-keys")) reasons.put("test-keys build");
        JSObject result = new JSObject();
        result.put("compromised", reasons.length() > 0);
        result.put("reasons", reasons);
        call.resolve(result);
    }

    /**
     * Whether this build can register for push (mobile plan M4). Android push needs Firebase,
     * which the google-services Gradle plugin configures from google-services.json at build time
     * (it generates the google_app_id string). Without it the push plugin's register() throws on
     * a plugin thread and Capacitor crashes the whole app, so the app asks here first.
     */
    @PluginMethod
    public void pushConfigured(PluginCall call) {
        Context context = getContext();
        int appId = context.getResources().getIdentifier("google_app_id", "string", context.getPackageName());
        JSObject result = new JSObject();
        result.put("configured", appId != 0);
        call.resolve(result);
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String name = validKey(call);
        if (name == null) return;
        synchronized (lock) {
            if (!prefs().edit().remove(name).commit()) {
                call.reject("Secure store write failed");
                return;
            }
            call.resolve();
        }
    }
}
