import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = readFileSync(resolve(
  process.cwd(),
  'scripts/check-classroom-blueprint-purge-concurrency-database.sh',
), 'utf8')

describe('Classroom/Blueprint purge concurrency fixture', () => {
  it('refuses an unexpected database and requires migration 136', () => {
    expect(script).toContain('com.supabase.cli.project')
    expect(script).toContain('PROJECT_LABEL" != "pika"')
    expect(script).toContain("version = '136'")
  })

  it('starts synchronized two-session races for every indirect lineage shape', () => {
    expect(script).toContain("'classroom_blueprint_purge_pair'")
    expect(script).toContain('course_blueprint_change_proposals')
    expect(script).toContain('course_blueprint_operations')
    expect(script).toContain('course_blueprint_editing_sessions')
    expect(script.match(/run_race \\\n/g)).toHaveLength(3)
  })

  it('requires exactly one fence and no staged deletion objects', () => {
    expect(script).toContain('winner_count')
    expect(script).toContain('did not admit exactly one owner')
    expect(script).toContain('staged_object_count')
    expect(script).toContain('loser staged deletion work')
  })
})
