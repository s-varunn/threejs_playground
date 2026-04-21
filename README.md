# Interactive Systems Lab

This is a small Three.js playground built with React, TypeScript, Vite, and Tailwind CSS.

It shows three interactive scenes:

- Particle Physics: a GPU-based particle simulation with 50,000+ particles that respond to gravity and mouse clicks.
- AI Embedding Space: a 3D scatter plot of 10,000 points that morphs between a spherical cluster and a structured grid.
- Lorenz Attractor: a real-time chaos simulation that draws a growing neon trail using a streaming buffer.

## Requirements

- Node.js
- pnpm

## Development

Install dependencies:

```bash
pnpm install
```

Run the app locally:

```bash
pnpm dev
```

By default the app runs on port 3000.

## Build

Create a production build:

```bash
pnpm build
```

Preview the production build:

```bash
pnpm serve
```

## Type checking

```bash
pnpm typecheck
```

## Project layout

- `src/` — app code, UI, hooks, and scenes
- `public/` — static assets
- `vite.config.ts` — Vite configuration
- `tsconfig.json` — TypeScript configuration

# ThreeJS_Playground
