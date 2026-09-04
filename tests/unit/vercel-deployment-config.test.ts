import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const vercel = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as {
  git?: {
    deploymentEnabled?: Record<string, boolean>
  }
}
const require = createRequire(import.meta.url)
const nextConfig = require(resolve(process.cwd(), 'next.config.js')) as {
  poweredByHeader?: boolean
  headers?: () => Promise<Array<{
    source: string
    has?: Array<{ type: string; key: string; value: string }>
    headers: Array<{ key: string; value: string }>
  }>>
}

describe('Vercel deployment configuration', () => {
  it('deploys only main and production, including for slash-containing feature branches', () => {
    expect(vercel.git?.deploymentEnabled).toEqual({
      main: true,
      production: true,
      '**': false,
    })
  })

  it('applies baseline browser security headers and preserves sensitive no-referrer routes', async () => {
    expect(nextConfig.poweredByHeader).toBe(false)
    const rules = await nextConfig.headers?.()
    expect(rules).toHaveLength(11)
    expect(rules?.[0].source).toBe('/(.*)')

    const headers = Object.fromEntries(
      rules?.[0].headers.map(({ key, value }) => [key.toLowerCase(), value]) ?? [],
    )
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['x-frame-options']).toBe('SAMEORIGIN')
    expect(headers['referrer-policy']).toBe('same-origin')
    expect(headers['permissions-policy']).toContain('camera=()')
    expect(headers['permissions-policy']).toContain('fullscreen=(self)')

    const noReferrerMatches = rules?.slice(1).map(({ headers: routeHeaders, ...match }) => {
      expect(routeHeaders).toEqual([{ key: 'Referrer-Policy', value: 'no-referrer' }])
      return match
    })
    expect(noReferrerMatches).toEqual([
      { source: '/api/storage/submission-images' },
      { source: '/api/student/tests/:id/documents/:docId/:delivery(file|snapshot)' },
      { source: '/api/teacher/tests/:id/documents/:docId/:delivery(file|snapshot)' },
      { source: '/api/student/attendance/:path*' },
      { source: '/api/teacher/attendance/:path*' },
      { source: '/api/integrations/attendance/:path*' },
      { source: '/api/cron/bara-attendance-smoke' },
      { source: '/attendance/check-in/:token' },
      { source: '/attendance/classroom/:token' },
      {
        source: '/login',
        has: [
          {
            type: 'query',
            key: 'next',
            value: '/attendance/(?:check-in|classroom)/.+',
          },
        ],
      },
    ])
  })
})
