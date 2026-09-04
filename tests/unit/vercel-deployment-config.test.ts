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

  it('applies baseline browser security headers to every route', async () => {
    expect(nextConfig.poweredByHeader).toBe(false)
    const rules = await nextConfig.headers?.()
    expect(rules).toHaveLength(1)
    expect(rules?.[0].source).toBe('/(.*)')

    const headers = Object.fromEntries(
      rules?.[0].headers.map(({ key, value }) => [key.toLowerCase(), value]) ?? [],
    )
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['x-frame-options']).toBe('SAMEORIGIN')
    expect(headers['referrer-policy']).toBe('no-referrer')
    expect(headers['permissions-policy']).toContain('camera=()')
    expect(headers['permissions-policy']).toContain('fullscreen=(self)')
  })
})
