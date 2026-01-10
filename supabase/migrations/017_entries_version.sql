-- Migration: Add version column for optimistic concurrency on entries

ALTER TABLE public.entries
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

UPDATE public.entries
SET version = 1
WHERE version IS NULL;

COMMENT ON COLUMN public.entries.version IS 'Monotonic version for optimistic concurrency control on daily log entries.';
