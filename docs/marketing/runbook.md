# Marketing Engine Runbook

## Preconditions
1. Dev server running at `http://localhost:3017`:
   ```bash
   PORT=3017 pnpm dev
   ```
2. Valid env file present (`.env.local` by default), or set `ENV_FILE=...`.
3. `ffmpeg` available on PATH.

## One-command build
```bash
ALLOW_MARKETING_SEED=true CAPTURE_BASE_URL=http://localhost:3017 pnpm build:marketing
```

## Phase commands (optional)
```bash
ALLOW_MARKETING_SEED=true pnpm seed:marketing
pnpm auth:marketing
pnpm capture:marketing
pnpm walkthrough:marketing
pnpm voiceover:marketing
pnpm captions:marketing
pnpm video:marketing
pnpm bundle:marketing
```

## Output
Final publish bundle:
- `artifacts/marketing/publish/manifest.json`
- `artifacts/marketing/publish/screens/*`
- `artifacts/marketing/publish/video/*`
- `artifacts/marketing/publish/audio/*`
- `artifacts/marketing/publish/captions/*`
- `artifacts/marketing/publish/copy/*`
