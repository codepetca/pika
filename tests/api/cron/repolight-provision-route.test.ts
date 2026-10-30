import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/cron/repolight-provision/route'
import { drainRepoLightProvisionOutbox } from '@/lib/server/repolight-provision-runtime'
vi.mock('@/lib/server/repolight-provision-runtime', () => ({ drainRepoLightProvisionOutbox: vi.fn() }))
const context = { params: Promise.resolve({}) }
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
describe('RepoLight provisioning recovery authorization', () => {
  it.each([undefined, '', 'wrong'])('rejects missing configuration or incorrect credentials before storage access', async secret => {
    if (secret === undefined) vi.stubEnv('CRON_SECRET', undefined)
    else vi.stubEnv('CRON_SECRET', secret)
    const response = await GET(new NextRequest('http://localhost/api/cron/repolight-provision', { headers: { authorization: 'Bearer fixture' } }), context)
    expect(response.status).toBe(401)
    expect(drainRepoLightProvisionOutbox).not.toHaveBeenCalled()
  })
  it('uses only the bounded server worker after cron authorization', async () => {
    vi.stubEnv('CRON_SECRET', 'fixture')
    vi.mocked(drainRepoLightProvisionOutbox).mockResolvedValue({ status: 'disabled' })
    const response = await GET(new NextRequest('http://localhost/api/cron/repolight-provision?limit=1000', { headers: { authorization: 'Bearer fixture' } }), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'disabled' })
    expect(drainRepoLightProvisionOutbox).toHaveBeenCalledExactlyOnceWith({ limit: 10 })
  })
})
