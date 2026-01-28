-- Migration: Drop unused profiles view
-- Purpose: Remove convenience alias that was never adopted and shows as unrestricted

DROP VIEW IF EXISTS profiles;
