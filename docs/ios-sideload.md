# Testing Orbit on an iPhone without the App Store

iPhones only run apps signed with an Apple certificate. Without a paid Apple Developer account
($99/year, which TestFlight needs), a tester can sign the app themselves with a free Apple ID.
The unsigned `.ipa` comes from Mobile CI (`.github/workflows/mobile.yml`, artifact
`orbit-ios-unsigned`).

## What you need

- An iPhone on iOS 16 or later, and its USB cable.
- A Windows PC or a Mac.
- A free Apple ID. A spare one is safest: the signing tool signs in to Apple with it.

## Install (Sideloadly, Windows or Mac)

1. On Windows, install **iTunes** and **iCloud** from apple.com, not the Microsoft Store versions.
   Sideloadly needs their drivers.
2. Install **Sideloadly** from sideloadly.io.
3. Plug in the iPhone, unlock it, and tap **Trust** on the phone.
4. Drag the Orbit `.ipa` into Sideloadly, type the Apple ID, and press **Start**. Enter the
   password and any two-factor code Apple asks for.
5. On the iPhone:
   - **Settings → Privacy & Security → Developer Mode → On**, then restart when asked.
   - **Settings → General → VPN & Device Management**, tap your Apple ID, then **Trust**.
6. Open Orbit.

AltStore (altstore.io) works too, and can refresh the app over Wi-Fi by itself.

## Limits of a free Apple ID

- The app stops opening after **7 days**. Sign it again the same way (or let AltStore or
  Sideloadly's auto-refresh do it). Chats and keys stay on the phone.
- At most 3 sideloaded apps per Apple ID at a time.
- **No push notifications**: Apple only gives push to paid accounts. Orbit still works while it is
  open.
- If Sideloadly says the bundle ID is unavailable, set a different one in its advanced options
  (for example `com.yourname.orbit`).

## Before testing

While the server runs without per-device keys, sign up with a **new test account** on the iPhone.
Signing in to an account that is already used on another device moves its key to the iPhone and
cuts the other device off from new messages.
