import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } from "@capacitor/barcode-scanner";
import { PrivacyScreen } from "@capacitor/privacy-screen";
import { PushNotifications } from "@capacitor/push-notifications";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import type { PlatformOverrides, SecureStore } from "./index";

/**
 * The iOS and Android shells (mobile plan M3). Starts from the browser implementation and
 * replaces what a web view can't do safely:
 *
 * - Secrets go to the app's own `SecureStore` plugin (`native/secure-store`, wired into both
 *   native projects by `cap sync`): an Android Keystore AES-GCM key (StrongBox when the
 *   device has it) wrapping each value, and iOS Keychain items that are this-device-only, kept
 *   out of backups, in the shared access group the notification extension will read later (B4).
 * - QR codes come from the camera (linking, B7).
 * - The app switcher shows a blank screen and Android blocks screenshots (privacy screen).
 */

type NativeSecureStore = {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
  deviceIntegrity(): Promise<{ compromised: boolean; reasons: string[] }>;
};

const NativeSecureStore = registerPlugin<NativeSecureStore>("SecureStore");

/** Only `orbit:*` keys, the same rule as the desktop keychain store. */
function checkKey(key: string) {
  if (!/^orbit:[A-Za-z0-9:_.-]{1,200}$/.test(key)) throw new Error("Invalid secure store key");
}

export const nativeSecureStore: SecureStore = {
  get: async (key) => {
    checkKey(key);
    return (await NativeSecureStore.get({ key })).value ?? null;
  },
  set: async (key, value) => {
    checkKey(key);
    await NativeSecureStore.set({ key, value });
  },
  remove: async (key) => {
    checkKey(key);
    await NativeSecureStore.remove({ key });
  }
};

export function isNativeShell() {
  return Capacitor.isNativePlatform();
}

export async function capacitorPlatform(): Promise<PlatformOverrides> {
  const ios = Capacitor.getPlatform() === "ios";
  // Blank app-switcher snapshot on iOS; FLAG_SECURE (no screenshots or screen recording) on Android.
  await PrivacyScreen.enable().catch(() => undefined);
  return {
    kind: ios ? "ios" : "android",
    deviceName: ios ? "Orbit iOS" : "Orbit Android",
    secureStore: nativeSecureStore,
    // No taskbar on phones; push (M4) is what gets attention.
    requestAttention: () => undefined,
    appInfo: async () => {
      const info = await App.getInfo().catch(() => null);
      return { version: info?.version ?? "unknown", os: Capacitor.getPlatform() };
    },
    pushToken: async () => {
      try {
        let permission = await PushNotifications.checkPermissions();
        if (permission.receive === "prompt" || permission.receive === "prompt-with-rationale") {
          permission = await PushNotifications.requestPermissions();
        }
        if (permission.receive !== "granted") return null;
        const token = await new Promise<string | null>((resolve) => {
          const done = (value: string | null) => {
            void registration.then((l) => l.remove());
            void failure.then((l) => l.remove());
            resolve(value);
          };
          const registration = PushNotifications.addListener("registration", (t) => done(t.value));
          const failure = PushNotifications.addListener("registrationError", () => done(null));
          void PushNotifications.register().catch(() => done(null));
        });
        return token ? { platform: ios ? "apns" : "fcm", token } : null;
      } catch {
        return null;
      }
    },
    onAppStateChange: (listener) => {
      const handle = App.addListener("appStateChange", ({ isActive }) => listener(isActive));
      return () => void handle.then((h) => h.remove());
    },
    biometric: {
      available: async () => {
        const result = await NativeBiometric.isAvailable({ useFallback: true }).catch(() => null);
        return Boolean(result?.isAvailable);
      },
      verify: async (reason) => {
        try {
          await NativeBiometric.verifyIdentity({ reason, title: "Unlock Orbit", useFallback: true, maxAttempts: 3 });
          return true;
        } catch {
          return false;
        }
      }
    },
    deviceIntegrity: () => NativeSecureStore.deviceIntegrity(),
    scanQrCode: async () => {
      try {
        const result = await CapacitorBarcodeScanner.scanBarcode({
          hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
          scanInstructions: "Point the camera at the code on your other device",
          scanButton: false
        });
        return result.ScanResult || null;
      } catch {
        // Cancelled, or the camera permission was refused.
        return null;
      }
    }
  };
}
