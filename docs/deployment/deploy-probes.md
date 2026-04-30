# Deployment Probes

This file records intentional no-runtime-change deploy probes.

## 2026-04-30 Vercel production trigger probe

- Purpose: verify whether Vercel creates a production deployment after `main` is merged into `production`.
- Baseline `origin/main`: `c84ad7e7f200`
- Baseline `origin/production`: `97e0e4716562`
- Expected app impact: none; this is a documentation-only change.
