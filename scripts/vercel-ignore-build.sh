#!/bin/bash
# Vercel Ignored Build Step
# Only build on main and production branches
# https://vercel.com/docs/deployments/configure-a-build#ignored-build-step

if [[ "$VERCEL_GIT_COMMIT_REF" == "main" ]] || [[ "$VERCEL_GIT_COMMIT_REF" == "production" ]] ; then
  # Proceed with the build
  echo "✅ Building $VERCEL_GIT_COMMIT_REF"
  exit 1;
else
  # Don't build
  echo "🛑 Skipping build for branch: $VERCEL_GIT_COMMIT_REF"
  exit 0;
fi
