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

import { attestDirectMutations } from '../../scripts/test-http-mixed-launcher'

describe('direct mutation attestation', () => {
  const operations = () => new Map([
    ['test_learner_self_mutation_v1:start:200', 2],
    ['test_learner_self_mutation_v1:save:200', 4],
    ['test_learner_self_mutation_v1:submit:200', 2],
    ['test_learner_self_mutation_v1:focus:200', 2],
    ['test_learner_workflow_v1:history-write:200', 2],
  ])
  it('requires the complete direct path and rejects fallback, inspect and missing RPC', () => {
    expect(() => attestDirectMutations(2, operations(), new Map())).not.toThrow()
    for (const [key, value] of [
      ['test_learner_self_mutation_v1:save:200', 3],
      ['test_learner_workflow_v1:start:200', 1],
      ['test_learner_workflow_v1:inspect:200', 1],
    ] as const) {
      const counts = operations(); counts.set(key, value)
      expect(() => attestDirectMutations(2, counts, new Map())).toThrow()
    }
    expect(() => attestDirectMutations(2, operations(), new Map([['test_learner_self_mutation_v1:404:PGRST202', 1]]))).toThrow()
  })
})

describe('learner operation gateway counters', () => {
  it('counts both RPCs by allowlisted operation without retaining payloads', async () => {
    const { createServer } = await import('node:http')
    const { createOwnedGateway } = await import('../../scripts/test-http-mixed-launcher')
    const upstream = createServer((req, res) => { req.resume(); req.on('end', () => res.writeHead(200).end('{}')) })
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
    const upstreamAddress = upstream.address()
    if (!upstreamAddress || typeof upstreamAddress === 'string') throw new Error('missing upstream address')
    const aggregate = new Map<string, number>(), byRpc = new Map<string, number>()
    const gateway = createOwnedGateway(new Map(), upstreamAddress.port, false, new Map(), aggregate, byRpc)
    await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve))
    const address = gateway.address()
    if (!address || typeof address === 'string') throw new Error('missing gateway address')
    try {
      for (const rpc of ['test_learner_workflow_v1', 'test_learner_self_mutation_v1']) {
        const response = await fetch(`http://127.0.0.1:${address.port}/rest/v1/rpc/${rpc}`, { method: 'POST', body: JSON.stringify({ p_operation: 'save', p_payload: 'private' }) })
        expect(response.status).toBe(200)
        await response.text()
      }
      expect(Object.fromEntries(aggregate)).toEqual({ 'save:200': 2 })
      expect(Object.fromEntries(byRpc)).toEqual({ 'test_learner_workflow_v1:save:200': 1, 'test_learner_self_mutation_v1:save:200': 1 })
    } finally {
      await Promise.all([new Promise<void>(resolve => gateway.close(() => resolve())), new Promise<void>(resolve => upstream.close(() => resolve()))])
    }
  })
})
