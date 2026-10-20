import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  assertLocalClassroomArchiveRecoveryDrillTarget,
  CLASSROOM_ARCHIVE_RECOVERY_DRILL_ACK,
} from '@/lib/server/classroom-archive-recovery-drill'

function jwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.')
}

const localServiceRoleKey = jwt({ iss: 'supabase-demo', role: 'service_role' })

describe('classroom archive recovery drill target guard', () => {
  it('keeps both owner labels, contextual recovery and legacy replay in the native drill', () => {
    // Source coverage only; actual PostgreSQL/Storage evidence comes from the guarded CI drill.
    const source = readFileSync(resolve(process.cwd(), 'scripts/run-classroom-archive-recovery-drill.ts'), 'utf8')
    expect(source).toContain("await runRecoveryDrill('teacher')")
    expect(source).toContain("await runRecoveryDrill('student')")
    expect(source).toContain('role: args.ownerRole')
    expect(source).toContain('const denied = await restoreContextualClassroomArchive(')
    expect(source).toContain('const restored = await restoreContextualClassroomArchive(')
    expect(source).toContain('const restoreReplay = await restoreContextualClassroomArchive(')
    expect(source).toContain('const legacyRestoreReplay = await restoreClassroomArchive(')
    expect(source).toContain('await removeFixture(')
    expect(source).toContain('await assertRowAbsent(supabase, \'classroom_archive_operations\', \'id\', ids.restoreOperation)')
  })

  it.each([
    'http://127.0.0.1:54321',
    'http://localhost:54321/',
    'http://[::1]:54321',
  ])('accepts the local Supabase target %s', (supabaseUrl) => {
    expect(assertLocalClassroomArchiveRecoveryDrillTarget({
      acknowledgement: CLASSROOM_ARCHIVE_RECOVERY_DRILL_ACK,
      serviceRoleKey: localServiceRoleKey,
      supabaseUrl,
    })).toEqual({ supabaseUrl: new URL(supabaseUrl).origin })
  })

  it.each([
    'https://project.supabase.co',
    'http://127.0.0.1.example.com:54321',
    'https://127.0.0.1:54321',
    'http://user:password@127.0.0.1:54321',
    'http://127.0.0.1:54321/rest/v1',
    'http://127.0.0.1:54321?target=remote',
  ])('rejects the unsafe target %s', (supabaseUrl) => {
    expect(() => assertLocalClassroomArchiveRecoveryDrillTarget({
      acknowledgement: CLASSROOM_ARCHIVE_RECOVERY_DRILL_ACK,
      serviceRoleKey: localServiceRoleKey,
      supabaseUrl,
    })).toThrow('requires a loopback Supabase URL')
  })

  it('requires the exact destructive-operation acknowledgement', () => {
    expect(() => assertLocalClassroomArchiveRecoveryDrillTarget({
      acknowledgement: 'yes',
      serviceRoleKey: localServiceRoleKey,
      supabaseUrl: 'http://127.0.0.1:54321',
    })).toThrow('acknowledgement is missing')
  })

  it.each([
    undefined,
    'sb_secret_remote',
    jwt({ iss: 'supabase', role: 'service_role' }),
    jwt({ iss: 'supabase-demo', role: 'authenticated' }),
  ])('rejects a non-local service-role credential', (serviceRoleKey) => {
    expect(() => assertLocalClassroomArchiveRecoveryDrillTarget({
      acknowledgement: CLASSROOM_ARCHIVE_RECOVERY_DRILL_ACK,
      serviceRoleKey,
      supabaseUrl: 'http://127.0.0.1:54321',
    })).toThrow('requires a local service-role key')
  })
})
