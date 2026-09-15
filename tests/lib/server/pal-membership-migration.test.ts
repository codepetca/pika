import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/168_pal_membership_identity_foundation.sql', 'utf8')

describe('Pal membership migration installation boundary', () => {
  it('installs all dependent objects in one explicit transaction', () => {
    expect(sql.indexOf('\nbegin;')).toBeGreaterThan(-1)
    expect(sql.indexOf('\nbegin;')).toBeLessThan(sql.indexOf('create table'))
    expect(sql.trimEnd().endsWith('commit;')).toBe(true)
  })

  it('excludes source writes before either backfill until trigger installation commits', () => {
    const lock = sql.indexOf('lock table public.classroom_roster, public.classroom_enrollments\n  in share row exclusive mode;')
    expect(lock).toBeGreaterThan(sql.indexOf('\nbegin;'))
    expect(lock).toBeLessThan(sql.indexOf('insert into private.pal_membership_generations'))
    expect(sql.indexOf('create trigger track_pal_removed_roster')).toBeLessThan(sql.lastIndexOf('\ncommit;'))
    expect(sql.indexOf('create trigger track_pal_membership_enrollment_insert')).toBeLessThan(sql.lastIndexOf('\ncommit;'))
  })
})
