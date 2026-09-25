# VC Online

VC Online is a browser-based game project focused on fast loading, modern browser compatibility, local asset storage, and a clean play experience on desktop and mobile.

## Features

- Runs directly in a modern web browser
- WebAssembly-powered runtime
- Desktop keyboard and gamepad support
- Mobile touch controls
- Local browser storage for game data
- Save management tools
- Mod management tools
- Fullscreen support
- Configurable frame-rate controls
- Offline-friendly asset handling after setup
- Responsive interface for desktop and mobile

## Tech Stack

- JavaScript
- Vite
- WebAssembly
- Service Workers
- OPFS
- IndexedDB
- HTML and CSS

## Development

Requirements:

- Node.js 20+
- pnpm

Install dependencies:

```bash
pnpm install
```

Start the development server:

```bash
pnpm dev
```

Create a production build:

```bash
pnpm build
```

Preview the production build locally:

```bash
pnpm preview
```

## Project Structure

```text
.
├── index.html
├── src/
│   ├── main.js
│   ├── style.css
│   ├── game-tools.js
│   ├── mod-manager.js
│   ├── save-manager.js
│   └── vc-cheats-user.js
├── public/
│   ├── game.js
│   ├── sw.js
│   ├── extract-worker.js
│   ├── GamepadEmulator.js
│   ├── idbfs.js
│   ├── modules/
│   └── blog/
├── package.json
├── pnpm-lock.yaml
└── vite.config.js
```

## Configuration

The game asset source can be overridden with:

```env
VITE_ASSET_URL=https://your-asset-endpoint.example/
```

## Notes

This repository is intended for development and experimentation with the VC Online browser client. Third-party components, assets, notices, and licenses remain subject to their respective terms where applicable.

## Project Name

**VC Online**
