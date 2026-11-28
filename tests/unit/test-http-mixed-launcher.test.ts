import { describe, expect, it } from 'vitest'
import { isAllowedAppPath, isOwnedRestPath } from '../../scripts/test-http-mixed-launcher'

describe('disposable HTTP launcher boundaries', () => {
  it('accepts only the intended app routes and rejects authority and query injection', () => {
    expect(isAllowedAppPath('/api/student/tests/123e4567-e89b-12d3-a456-426614174000/attempt')).toBe(true)
    for (const path of ['http://example.com/api/student/tests/abc/start', '//example.com', '/api/student/tests/abc/start?x=y', '/api/teacher/tests/abc/../../other', '/api/student/tests/abc/start/other']) expect(isAllowedAppPath(path)).toBe(false)
  })
  it('only forwards REST-prefixed requests to the fixed upstream', () => {
    expect(isOwnedRestPath('/rest/v1/rpc/example?select=id')).toBe(true)
    for (const path of [undefined, '//example.com/rest/v1/x', 'http://example.com/rest/v1/x', '/auth/v1/token', '/rest/v1']) expect(isOwnedRestPath(path)).toBe(false)
  })
})

import { validateSupabaseTarget } from '../../scripts/test-http-mixed-launcher'

describe('Supabase CLI target attestation', () => {
  const project = 'pika_test_load_baseline_0123456789abcdef'
  const network = `supabase_network_${project}`
  const container = (role: string, id: string, env: string[]) => ({
    Id: id.repeat(64), Name: `/supabase_${role}_${project}`,
    State: { Running: true }, Config: { Image: role === 'db' ? 'supabase/postgres:15' : role === 'rest' ? 'supabase/postgrest:latest' : 'kong:2', Labels: { 'com.supabase.cli.project': project }, Env: env },
    NetworkSettings: { Networks: { [network]: { Aliases: [role] } }, Ports: role === 'kong' ? { '8000/tcp': [{ HostIp: '127.0.0.1', HostPort: '55421' }] } : {} },
  })
  const config = `services:\n  - name: rest-v1\n    _comment: 'PostgREST /rest/v1/*'\n    url: http://rest:3000/\n    routes:\n      - name: rest-v1-all\n        paths:\n          - /rest/v1/\n  - name: other\n    url: http://other:9999/\n`
  const fixtures = () => [container('db', 'a', []), container('rest', 'b', ['PGRST_DB_URI=postgres://authenticator:secret@db:5432/postgres']), container('kong', 'c', ['KONG_DECLARATIVE_CONFIG=/home/kong/kong.yml'])] as const
  it('accepts only the exact owned project and linked REST route', () => {
    const [db, rest, kong] = fixtures()
    expect(() => validateSupabaseTarget(db, rest, kong, project, 55421, config)).not.toThrow()
    expect(() => validateSupabaseTarget(db, rest, kong, 'pika', 55421, config)).toThrow()
    expect(() => validateSupabaseTarget(db, rest, kong, `${project}0`, 55421, config)).toThrow()
    expect(() => validateSupabaseTarget(db, rest, kong, project, 55421, config.replace('http://rest:3000/', 'http://other:3000/'))).toThrow()
    expect(() => validateSupabaseTarget(db, rest, kong, project, 55421, config.replace('/rest/v1/\n', '/auth/v1/\n'))).toThrow()
    expect(() => validateSupabaseTarget(db, rest, { ...kong, NetworkSettings: { ...kong.NetworkSettings, Ports: { '8000/tcp': [{ HostIp: '0.0.0.0', HostPort: '55421' }, { HostIp: '::', HostPort: '55421' }] } } }, project, 55421, config)).not.toThrow()
    expect(() => validateSupabaseTarget(db, rest, { ...kong, NetworkSettings: { ...kong.NetworkSettings, Ports: { '8000/tcp': [{ HostIp: '0.0.0.0', HostPort: '55421' }] } } }, project, 55421, config)).toThrow()
    expect(() => validateSupabaseTarget(db, { ...rest, Config: { ...rest.Config, Env: ['PGRST_DB_URI=postgres://authenticator:secret@elsewhere:5432/postgres'] } }, kong, project, 55421, config)).toThrow()
  })
})
