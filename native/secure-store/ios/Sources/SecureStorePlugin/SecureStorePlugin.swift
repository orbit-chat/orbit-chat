import Foundation
import Capacitor
import Security

/**
 * Orbit's secret storage on iOS (mobile plan B4): the device keys, the identity key and the
 * install ID, as Keychain items that are:
 *  - this device only (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`): never in backups,
 *    never restored to another device;
 *  - in the shared access group named by `OrbitKeychainAccessGroup` in Info.plist, so the
 *    Notification Service Extension (M4 encrypted previews) can read them without a migration.
 *
 * A failure to read an item that exists (e.g. before the first unlock after a reboot) is an
 * error, never "not found": the app must not generate a replacement device key over it.
 */
@objc(SecureStorePlugin)
public class SecureStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureStorePlugin"
    public let jsName = "SecureStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deviceIntegrity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushConfigured", returnType: CAPPluginReturnPromise)
    ]

    private let service = "com.orbit.chat.secure-store"
    private let maxValueLength = 64 * 1024
    private let keyPattern = try! NSRegularExpression(pattern: "^orbit:[A-Za-z0-9:_.-]{1,200}$")
    private let queue = DispatchQueue(label: "com.orbit.chat.secure-store")

    /// The shared group works only in builds signed by the team that owns it, where the value
    /// starts with the 10-character team ID. Unsigned CI builds re-signed for sideloading (e.g.
    /// Sideloadly with a free Apple ID) have no team prefix; they use the app's own Keychain group,
    /// since asking for a group the app isn't entitled to fails every read and write.
    private var accessGroup: String? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "OrbitKeychainAccessGroup") as? String,
              !group.isEmpty, !group.contains("$("),
              group.range(of: "^[A-Z0-9]{10}\\.", options: .regularExpression) != nil else { return nil }
        return group
    }

    private func query(for key: String) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecUseDataProtectionKeychain as String: true
        ]
        if let group = accessGroup { query[kSecAttrAccessGroup as String] = group }
        return query
    }

    private func validKey(_ call: CAPPluginCall) -> String? {
        guard let key = call.getString("key"),
              keyPattern.firstMatch(in: key, range: NSRange(key.startIndex..., in: key)) != nil else {
            call.reject("Invalid secure store key")
            return nil
        }
        return key
    }

    @objc func get(_ call: CAPPluginCall) {
        guard let key = validKey(call) else { return }
        queue.async {
            var query = self.query(for: key)
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            var item: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &item)
            switch status {
            case errSecSuccess:
                guard let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
                    call.reject("Secure store value can't be read", "locked")
                    return
                }
                call.resolve(["value": value])
            case errSecItemNotFound:
                call.resolve(["value": NSNull()])
            default:
                call.reject("Secure store is locked (\(status))", "locked")
            }
        }
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = validKey(call) else { return }
        guard let value = call.getString("value"), value.count <= maxValueLength, let data = value.data(using: .utf8) else {
            call.reject("Invalid secure store value")
            return
        }
        queue.async {
            var add = self.query(for: key)
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            var status = SecItemAdd(add as CFDictionary, nil)
            if status == errSecDuplicateItem {
                let attributes: [String: Any] = [
                    kSecValueData as String: data,
                    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                ]
                status = SecItemUpdate(self.query(for: key) as CFDictionary, attributes as CFDictionary)
            }
            if status == errSecSuccess {
                call.resolve()
            } else {
                call.reject("Secure store write failed (\(status))")
            }
        }
    }

    /// Advisory jailbreak signs (mobile plan M5): common jailbreak files, or a sandbox that lets the
    /// app write outside its container. Nothing is blocked; the app only warns.
    @objc func deviceIntegrity(_ call: CAPPluginCall) {
        #if targetEnvironment(simulator)
        call.resolve(["compromised": false, "reasons": []])
        #else
        var reasons: [String] = []
        let paths = [
            "/Applications/Cydia.app", "/Applications/Sileo.app", "/Library/MobileSubstrate/MobileSubstrate.dylib",
            "/usr/sbin/sshd", "/etc/apt", "/private/var/lib/apt/", "/var/jb", "/bin/bash"
        ]
        if let found = paths.first(where: { FileManager.default.fileExists(atPath: $0) }) {
            reasons.append("jailbreak file at \(found)")
        }
        let probe = "/private/orbit-jailbreak-probe.txt"
        if (try? "x".write(toFile: probe, atomically: true, encoding: .utf8)) != nil {
            try? FileManager.default.removeItem(atPath: probe)
            reasons.append("sandbox allows writing outside the app")
        }
        call.resolve(["compromised": !reasons.isEmpty, "reasons": reasons])
        #endif
    }

    /// APNs needs no build-time service file (only the push entitlement), so push is always
    /// available to register on iOS. Android answers from its Firebase configuration.
    @objc func pushConfigured(_ call: CAPPluginCall) {
        call.resolve(["configured": true])
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = validKey(call) else { return }
        queue.async {
            let status = SecItemDelete(self.query(for: key) as CFDictionary)
            if status == errSecSuccess || status == errSecItemNotFound {
                call.resolve()
            } else {
                call.reject("Secure store write failed (\(status))")
            }
        }
    }
}
