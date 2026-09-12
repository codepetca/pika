#!/usr/bin/env bash
set -euo pipefail

# Synthetic rollback-only tests. No migration application and no hosted URLs.
PAL_MEMBERSHIP_PROJECT="${PAL_MEMBERSHIP_PROJECT:-pika}"
PAL_MEMBERSHIP_CONTAINER="supabase_db_$PAL_MEMBERSHIP_PROJECT"
PAL_MEMBERSHIP_DATABASE="${PAL_MEMBERSHIP_DATABASE:-postgres}"
if [[ ! "$PAL_MEMBERSHIP_PROJECT" =~ ^[a-z0-9_-]+$ ]] \
  || [[ ! "$PAL_MEMBERSHIP_DATABASE" =~ ^(postgres|pika_pal_168_[a-z0-9_]+)$ ]]; then
  echo 'Refusing unexpected database target.' >&2
  exit 2
fi
PAL_MEMBERSHIP_LABEL="$(docker inspect "$PAL_MEMBERSHIP_CONTAINER" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')"
if [[ "$PAL_MEMBERSHIP_LABEL" != "$PAL_MEMBERSHIP_PROJECT" ]]; then
  echo 'Refusing unexpected Supabase project.' >&2
  exit 2
fi
docker exec -i "$PAL_MEMBERSHIP_CONTAINER" psql -U postgres -d "$PAL_MEMBERSHIP_DATABASE" -X -v ON_ERROR_STOP=1 \
  < "$(dirname "$0")/check-pal-membership-database.sql"
