import { describe, expect, it } from 'vitest'
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
