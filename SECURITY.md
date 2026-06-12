# Security Policy

Orbit Chat handles private messaging data. Please report suspected vulnerabilities privately instead of opening a public issue.

## Supported Versions

Security fixes are prioritized for the current desktop release line.

| Version | Supported |
| --- | --- |
| 0.9.x | Yes |
| Older releases | Best effort |

## Reporting A Vulnerability

Use GitHub private vulnerability reporting for the `orbit-chat/orbit-chat` repository when available. If private reporting is not enabled, contact the maintainers through a private channel before publishing details.

Include:

- affected version and operating system
- steps to reproduce
- expected and actual behavior
- screenshots or logs when they do not expose private message content
- impact assessment, especially whether plaintext, private keys, tokens, or update signing could be affected

Do not include real private keys, recovery codes, access tokens, or message plaintext in a report.

## Scope

In scope:

- authentication/session handling in the desktop client
- local key handling and encrypted message envelope handling
- Electron preload/main-process boundary issues
- update delivery and signing/notarization issues
- attachment encryption/download behavior

Out of scope:

- social engineering
- denial-of-service without a security boundary impact
- issues requiring physical access to an already unlocked machine unless they expose private keys or plaintext unexpectedly

## Disclosure

The project aims to acknowledge credible reports within 7 days, provide a remediation plan when confirmed, and publish a security note after users have had a reasonable update window.

