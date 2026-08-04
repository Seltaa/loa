# Security policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose API keys, local files, microphone audio, screen content, or Hermes access. Contact the maintainer privately through the security contact listed on their GitHub profile.

Include the affected version, reproduction steps, impact, and any suggested mitigation. Please avoid accessing data that is not your own.

## Current security model

Loa is designed as a local, single-user prototype. The Vite development proxy forwards Hermes requests to a loopback service. It is not a hardened multi-user server.

Known limitation: setup values, including API keys, are stored in browser `localStorage`. This protects them from accidental Git commits but not from malicious browser extensions, local malware, other scripts running on the same origin, or another person using the same browser profile.

Before using Loa:

- Use a dedicated, trusted browser profile.
- Keep Hermes bound to loopback and require a strong API key.
- Share only the window or screen you intend to show.
- Use **Stop All Sharing** before opening sensitive material.
- Revoke and replace a key if you believe it was exposed.
