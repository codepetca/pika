import { describe, expect, it } from 'vitest'
import { parseRepoLightConfig, resolveRepoLightConnection } from '@/lib/server/repolight-config'
const teacherId = '11111111-1111-4111-8111-111111111111'
const entry = { connectionRef: 'connection-1', teacherId, workspaceRef: 'customer_1', installationRef: 'pika-installation', apiKey: 'rl_v2_77777777-7777-4777-8777-777777777777.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' }
const configured = (extra = {}) => ({ NODE_ENV: 'production', PIKA_REPOLIGHT_ENABLED: 'true', REPOLIGHT_API_URL: 'https://reports.example.test', REPOLIGHT_TEACHER_CONNECTIONS_JSON: JSON.stringify([entry]), ...extra })
describe('RepoLight operator configuration', () => {
  it('defaults off without a fallback connection', () => { expect(parseRepoLightConfig({}).enabled).toBe(false); expect(() => resolveRepoLightConnection(parseRepoLightConfig({}), teacherId)).toThrow() })
  it('binds exact teacher/ref and retains inactive rotation entries', () => {
    const config = parseRepoLightConfig(configured({ REPOLIGHT_TEACHER_CONNECTIONS_JSON: JSON.stringify([entry, { ...entry, connectionRef: 'old', active: false }]) }))
    expect(resolveRepoLightConnection(config, teacherId).connectionRef).toBe('connection-1')
    expect(resolveRepoLightConnection(config, teacherId, 'old').connectionRef).toBe('old')
    expect(() => resolveRepoLightConnection(config, '22222222-2222-4222-8222-222222222222', 'old')).toThrow()
  })
  it.each(['http://reports.example.test', 'https://user:key@reports.example.test', 'https://reports.example.test/path', 'https://reports.example.test?x=1', 'https://reports.example.test#x'])('rejects unsafe origin %s', origin => { expect(() => parseRepoLightConfig(configured({ REPOLIGHT_API_URL: origin }))).toThrow() })
  it('permits literal loopback HTTP only in development', () => {
    expect(parseRepoLightConfig(configured({ NODE_ENV: 'development', REPOLIGHT_API_URL: 'http://127.0.0.1:3348' })).apiOrigin).toBe('http://127.0.0.1:3348')
    expect(() => parseRepoLightConfig(configured({ REPOLIGHT_API_URL: 'http://127.0.0.1:3348' }))).toThrow()
    expect(() => parseRepoLightConfig(configured({ NODE_ENV: 'development', REPOLIGHT_API_URL: 'http://localhost:3348' }))).toThrow()
  })
  it('rejects ambiguous teachers, reused refs, invalid flags and oversized configuration without echoing keys', () => {
    for (const extra of [{ PIKA_REPOLIGHT_ENABLED: 'TRUE' }, { REPOLIGHT_TEACHER_CONNECTIONS_JSON: JSON.stringify([entry, { ...entry, connectionRef: 'foreign-teacher', teacherId: '22222222-2222-4222-8222-222222222222' }]) }, { REPOLIGHT_TEACHER_CONNECTIONS_JSON: JSON.stringify([entry, entry]) }, { REPOLIGHT_TEACHER_CONNECTIONS_JSON: JSON.stringify([entry, { ...entry, connectionRef: 'other' }]) }, { REPOLIGHT_TEACHER_CONNECTIONS_JSON: 'x'.repeat(262145) }]) {
      expect(() => parseRepoLightConfig(configured(extra))).toThrow('RepoLight is not configured.')
    }
  })
})
