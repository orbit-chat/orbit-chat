# Orbit Chat Production Trust Plan

This document tracks the production trust work required before Orbit Chat should be positioned as a public private-messaging product.

## Current Automation

- `.github/workflows/ci.yml` runs desktop typechecking and Vite/Electron builds on Linux, macOS, and Windows.
- `.github/workflows/release.yml` builds signed desktop packages on version tags and publishes draft GitHub Releases with updater metadata.
- `.github/dependabot.yml` opens dependency and GitHub Actions update PRs.

## Desktop Signing And Notarization

Production releases must be signed. The release workflow fails before packaging if signing secrets are missing.

Required GitHub secrets:

- `MAC_CSC_LINK`: base64-encoded macOS Developer ID certificate or secure certificate URL accepted by electron-builder
- `MAC_CSC_KEY_PASSWORD`: password for the macOS signing certificate
- `APPLE_ID`: Apple ID used for notarization
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password for notarization
- `APPLE_TEAM_ID`: Apple Developer Team ID
- `WINDOWS_CSC_LINK`: base64-encoded Windows code-signing certificate or secure certificate URL accepted by electron-builder
- `WINDOWS_CSC_KEY_PASSWORD`: password for the Windows signing certificate
- `VITE_GIPHY_API_KEY`: production GIF API key, if GIF search remains enabled

Required GitHub repository variables:

- `VITE_API_URL`: production API base URL
- `VITE_SOCKET_URL`: production Socket.IO base URL

Release process:

1. Update `package.json` version.
2. Merge release changes to `main`.
3. Create and push a tag such as `v0.9.4`.
4. Wait for `Desktop Release`.
5. Download and smoke-test the draft release on macOS and Windows.
6. Publish the GitHub Release only after install, launch, login, messaging, attachment, update metadata, and quit/reopen checks pass.

## Auto-Update Reliability

The app uses `electron-updater` with GitHub Releases. A release must include:

- Windows installer: `Orbit-Chat-Setup-<version>.exe`
- Windows updater metadata: `latest.yml`
- macOS zip: `Orbit-Chat-<version>-<arch>-mac.zip`
- macOS updater metadata: `latest-mac.yml`

Do not publish release assets manually unless those metadata files are present and match the artifacts built by CI.

## Crash And Error Reporting

Before broad beta, choose a crash/error reporting provider or build a private ingestion endpoint. Minimum required events:

- Electron main-process unhandled exceptions and unhandled promise rejections
- renderer runtime errors
- renderer unhandled promise rejections
- renderer blank-screen or fatal startup failures
- updater failures
- socket connection/auth refresh failures

Privacy constraints:

- never send message plaintext
- never send private keys, conversation keys, recovery codes, access tokens, or refresh tokens
- redact usernames from free-form logs unless the user explicitly opts into diagnostics
- include app version, platform, architecture, and error code/category

Recommended rollout:

1. Add an explicit "Send diagnostics" setting.
2. Default broad crash telemetry off until the privacy policy is published.
3. Keep a local diagnostic export for users who prefer manual support.
4. Review sample reports before beta to verify no private content leaves the device.

## Security Disclosure

The desktop repository includes `SECURITY.md`. The public website should link to a disclosure page that tells reporters to use private vulnerability reporting, not public issues.

## Backup And Recovery

Desktop recovery depends on account recovery codes, device key handling, and backend backups. The server repository owns the operational database and media backup runbook.

Desktop-specific requirements before beta:

- explain that losing all trusted devices and recovery codes can make encrypted history unrecoverable
- show recovery-code status in account settings
- allow users to refresh recovery codes while still authenticated
- document device replacement and lost-device revocation

## External Security Audit

Do not market Orbit as audited until a third party has reviewed the cryptography envelope, Electron hardening, server authorization checks, update pipeline, and recovery flows.

Audit readiness checklist:

- CI is required on protected branches
- release artifacts are signed and notarized
- threat model is written
- crypto design document is current
- auth, key exchange, group rekeying, attachment encryption, and passcode flows have tests
- private vulnerability reporting is enabled
- dependency update process is active

