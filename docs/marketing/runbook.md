# Marketing Engine Runbook

## Preconditions
1. Staging URL available and reachable (recommended capture target).
2. Valid env file present (`.env.local` by default), or set `ENV_FILE=...`.
3. `ffmpeg` available on PATH.
4. Non-local capture guard is enabled by default. To run locally, set `CAPTURE_ALLOW_LOCAL_MARKETING=true`.

## One-command build
```bash
CAPTURE_BASE_URL=https://your-staging-host CAPTURE_PACING_MODE=slow pnpm build:marketing
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

## Local dry-run override (optional)
```bash
PORT=3017 pnpm dev
CAPTURE_ALLOW_LOCAL_MARKETING=true ALLOW_MARKETING_SEED=true CAPTURE_BASE_URL=http://localhost:3017 pnpm build:marketing
```

## Output
Final publish bundle:
- `artifacts/marketing/publish/manifest.json`
- `artifacts/marketing/publish/screens/*`
- `artifacts/marketing/publish/video/*`
- `artifacts/marketing/publish/audio/*`
- `artifacts/marketing/publish/captions/*`
- `artifacts/marketing/publish/copy/*`
