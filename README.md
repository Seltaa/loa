# Loa

Loa is a personal companion HUD that combines realtime Gemini Live voice, optional screen or OBS context, and background Hermes tasks in one calm interface.

> Experimental software. Loa can transmit microphone audio and selected screen or camera frames to Gemini. Review the privacy notes before use.

## Features

- Gemini Live voice with Leda by default, selectable voices, and personal instructions
- Screen sharing, webcams, and optional OBS Virtual Camera
- Up to 10 attachments per message, including pasted photos, text-based PDFs, TXT, and code files
- Local chat history and saved photo previews, with a jump-to-latest button
- Automatic contextual memories and a journal, with date browsing and editing
- Live reconnection handling and controls to restart Loa with saved context
- Separate settings and first-launch setup, with Gemini and Hermes connection checks
- Background search and tasks through a local Hermes gateway
- A light purple interface and an inline OBS setup guide

Scanned PDFs require OCR first. PDF support extracts text, not page illustrations. Attachments and screen observations are interpreted by the model and may be incomplete.

## OBS setup

1. Add Game Capture or another source in OBS and check the preview.
2. Click **Start Virtual Camera** in OBS. Streaming and recording are not needed.
3. In Loa, expand **Camera / OBS (optional)**, select **OBS Virtual Camera**, then click **Start camera**. Use **Rescan cameras** if necessary.
4. Click **Start Loa** for voice conversation. Keep OBS running.

OBS is optional: **Share Screen** captures a screen or window directly.
## Requirements

- Node.js 22.12 or newer
- A Gemini API key from Google AI Studio
- Optional: Hermes with its local API enabled
- Optional: OBS Virtual Camera

## Run locally

```bash
git clone https://github.com/Seltaa/loa.git
cd loa
npm install
npm run dev
```

Open the local URL printed by Vite and complete the setup wizard.

## Privacy and security

- Screen and camera frames are sent only while Live View is active.
- Microphone audio is sent while Gemini Live and microphone listening are active.
- Stop sharing to end the screen/camera feed; use the voice controls to stop the Live conversation separately.
- Configuration, conversation history, memories, and journal entries are stored locally in your browser. Saved photo previews use IndexedDB. Browser profiles and local addresses have separate storage.
- Gemini and Hermes keys are currently stored in that same browser storage. Use Loa only on a trusted local profile and never on a shared or public computer.
- The Hermes proxy is intended for a loopback/local gateway. Do not expose an unauthenticated Hermes endpoint to a network.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and current limitations.

## Scripts

```bash
npm run dev      # development server
npm run build    # type-check and production build
npm run lint     # static analysis
npm run preview  # preview the production build
```

## Project status

Loa is an early open-source prototype. Interfaces and stored data formats may change before `1.0.0`.

## Inspiration

Loa was independently built after trying and being inspired by [ASHR12/iris](https://github.com/ASHR12/iris), an open-source desktop AI companion. Thank you to its creator for sharing the project.

Loa is not affiliated with or endorsed by the IRIS project, Google, OBS, or Hermes.

## License

[MIT](LICENSE)
