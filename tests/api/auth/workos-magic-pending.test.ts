import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const clearPending = vi.hoisted(() => vi.fn())

vi.mock('@/lib/server/workos-magic-pending', () => ({
  clearPendingWorkOSMagicAuth: clearPending,
}))

import { DELETE } from '@/app/api/auth/workos/magic/pending/route'

describe('DELETE /api/auth/workos/magic/pending', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_LEGACY_PASSWORD_AUTH', 'false')
  })

  afterEach(() => vi.unstubAllEnvs())

  it('clears the pending challenge without returning identity state', async () => {
    const response = await DELETE(new NextRequest(
      'http://localhost:3000/api/auth/workos/magic/pending',
      { method: 'DELETE' },
    ))

    expect(response.status).toBe(204)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(clearPending).toHaveBeenCalledOnce()
  })

  it('is unavailable while the explicit legacy password override is on', async () => {
    vi.stubEnv('PIKA_LEGACY_PASSWORD_AUTH', 'true')

    const response = await DELETE(new NextRequest(
      'http://localhost:3000/api/auth/workos/magic/pending',
      { method: 'DELETE' },
    ))

    expect(response.status).toBe(404)
    expect(clearPending).not.toHaveBeenCalled()
  })
})
