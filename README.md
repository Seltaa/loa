# Loa

Loa is a personal companion HUD that combines realtime Gemini Live voice, optional screen or OBS context, and background Hermes tasks in one calm interface.

> Experimental software. Loa can transmit microphone audio and selected screen or camera frames to Gemini. Review the privacy notes before use.

## Features

- Realtime voice conversation with Gemini Live
- Screen sharing or OBS Virtual Camera context
- Microphone wake, sleep, and reconnect controls
- Background search and task execution through a local Hermes gateway
- Local conversation and lightweight memory
- Visible sharing state and a one-click **Stop All Sharing** control

## Requirements

- Node.js 20 or newer
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
- **Stop All Sharing** stops the active view, microphone capture, and Gemini Live connection.
- Configuration, conversation history, and lightweight memory are stored in browser `localStorage` on the current device.
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
