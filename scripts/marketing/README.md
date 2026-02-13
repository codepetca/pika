# Marketing Scripts

This folder contains modular capture/audio scripts used to generate marketing assets from seeded demo data.

## Entry points
- `pnpm seed:marketing` -> `scripts/seed-marketing-demo.ts`
- `pnpm capture:marketing` -> `scripts/marketing/capture.ts` (via wrapper `scripts/capture-marketing-shots.ts`)
- `pnpm voiceover:marketing` -> `scripts/marketing/generate-voiceover.sh` (via wrapper `scripts/generate-marketing-voiceover.sh`)

## Environment
- Base URL: `CAPTURE_BASE_URL` (default `http://localhost:3017`)
- Classroom: `CAPTURE_CLASS_CODE` (default `MKT101`)
- Env file: `ENV_FILE` (default `.env.local`)
