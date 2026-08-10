import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = readFileSync(resolve(
  process.cwd(),
  'scripts/check-cold-archived-classroom-purge-database.sh',
), 'utf8')

describe('cold Classroom purge database fixture', () => {
  it('refuses an unexpected database target and requires migration 122', () => {
    expect(script).toContain('com.supabase.cli.project')
    expect(script).toContain('PROJECT_LABEL" != "pika"')
    expect(script).toContain("version = '122'")
    expect(script).toContain('Migration 122 is not applied to the local database')
  })

  it('keeps destructive evidence inside a rollback-only transaction', () => {
    expect(script).toContain('begin;')
    expect(script).toContain('rollback;')
    expect(script).not.toMatch(/\bcommit\s*;/i)
  })

  it('covers ownership, conflict, lease, retry, archive-last, and preservation boundaries', () => {
    expect(script).toContain('Non-owner learned cold purge inventory')
    expect(script).toContain('Active restore did not block cold purge')
    expect(script).toContain('Live lease was claimed concurrently')
    expect(script).toContain('Retryable Storage failure was not recorded')
    expect(script).toContain('Authoritative recovery archive was not claimed last')
    expect(script).toContain('User, Blueprint, or other Classroom was removed')
  })
})
