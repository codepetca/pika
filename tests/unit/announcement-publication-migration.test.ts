import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readMigration() {
  return readFileSync(
    resolve(process.cwd(), 'supabase/migrations/160_announcement_drafts_and_publication_time.sql'),
    'utf8',
  )
}

describe('announcement publication migration', () => {
  it('preserves historical edit timestamps during the publication backfill', () => {
    const migration = readMigration()
    const snapshot = migration.indexOf('create temporary table announcement_publication_backfill_timestamps')
    const disable = migration.indexOf('disable trigger announcements_updated_at_trigger')
    const backfill = migration.indexOf('set published_at = coalesce(scheduled_for, created_at)')
    const enable = migration.indexOf('enable trigger announcements_updated_at_trigger')
    const assertion = migration.indexOf("raise exception 'Announcement publication backfill changed updated_at'")

    expect(snapshot).toBeGreaterThanOrEqual(0)
    expect(disable).toBeGreaterThan(snapshot)
    expect(backfill).toBeGreaterThan(disable)
    expect(enable).toBeGreaterThan(backfill)
    expect(assertion).toBeGreaterThan(enable)
  })
})
