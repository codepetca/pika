# Marketing Scripts

This folder contains modular capture/audio scripts used to generate marketing assets from seeded demo data.

## Entry points
- `pnpm seed:marketing` -> `scripts/seed-marketing-demo.ts`
- `pnpm auth:marketing` -> `scripts/marketing/auth.ts`
- `pnpm capture:marketing` -> `scripts/marketing/capture.ts` (via wrapper `scripts/capture-marketing-shots.ts`)
- `pnpm walkthrough:marketing` -> `scripts/marketing/walkthrough.ts`
- `pnpm voiceover:marketing` -> `scripts/marketing/generate-voiceover.sh` (via wrapper `scripts/generate-marketing-voiceover.sh`)
- `pnpm captions:marketing` -> `scripts/marketing/generate-captions.ts`
- `pnpm video:marketing` -> `scripts/marketing/render-video.sh`
- `pnpm bundle:marketing` -> `scripts/marketing/bundle.ts`
- `pnpm build:marketing` -> `scripts/marketing/build-all.sh`

## Environment
- Base URL: `CAPTURE_BASE_URL` (default `http://localhost:3017`)
- Classroom: `CAPTURE_CLASS_CODE` (default `MKT101`)
- Env file: `ENV_FILE` (default `.env.local`)
- Auth users:
  - `CAPTURE_TEACHER_EMAIL` (default `teacher.marketing@example.com`)
  - `CAPTURE_STUDENT_EMAIL` (default `ava.chen@example.com`)
  - `CAPTURE_PASSWORD` (default `test1234`)
- UI mode flags:
  - `CAPTURE_LEFT_SIDEBAR_EXPANDED=true`
  - `CAPTURE_DARK_MODE=true`

## Full Build
Run this after starting the app locally:

```bash
PORT=3017 pnpm dev
```

Then in another terminal:

```bash
ALLOW_MARKETING_SEED=true CAPTURE_BASE_URL=http://localhost:3017 pnpm build:marketing
```
