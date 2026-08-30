import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const workOSMocks = vi.hoisted(() => ({
  authkit: vi.fn(),
  partitionAuthkitHeaders: vi.fn(),
  applyResponseHeaders: vi.fn((response: Response, headers: Headers) => {
    for (const [name, value] of headers) response.headers.set(name, value)
    return response
  }),
}))

vi.mock('@workos-inc/authkit-nextjs', () => workOSMocks)

import middleware, { config } from '@/middleware'
import { PIKA_REQUEST_PATH_HEADER } from '@/lib/auth-redirect'

const [matcher] = config.matcher
const matchesPath = (pathname: string) => new RegExp(`^${matcher}$`).test(pathname)

describe('AuthKit middleware matcher', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('keeps passive assets out of AuthKit while covering application routes', () => {
    expect(matchesPath('/favicon.ico')).toBe(false)
    expect(matchesPath('/faviconXico')).toBe(true)
    expect(matchesPath('/favicon.ico/anything')).toBe(true)
    expect(matchesPath('/pika-icon-light.svg')).toBe(false)
    expect(matchesPath('/pika-icon-dark.svg')).toBe(false)
    expect(matchesPath('/pika-icon-lightXsvg')).toBe(true)
    expect(matchesPath('/pika-icon-dark.svg/anything')).toBe(true)
    expect(matchesPath('/classrooms')).toBe(true)
    expect(matchesPath('/_next/static/chunks/app.js')).toBe(false)
    expect(matchesPath('/_next/static')).toBe(false)
    expect(matchesPath('/_next/staticx')).toBe(true)
    expect(matchesPath('/_next/image')).toBe(false)
    expect(matchesPath('/_next/image/transform')).toBe(false)
    expect(matchesPath('/_next/imageevil')).toBe(true)

    const layout = readFileSync(resolve(process.cwd(), 'src/app/layout.tsx'), 'utf8')
    expect(layout).toContain("url: '/pika-icon-light.svg'")
    expect(layout).not.toContain("url: '/pika-icon-dark.svg'")
    expect(layout).not.toContain("media: '(prefers-color-scheme")

    for (const filename of ['pika-icon-light.svg', 'pika-icon-dark.svg']) {
      const favicon = readFileSync(resolve(process.cwd(), 'public', filename), 'utf8')
      expect(favicon).not.toContain('@media')
      expect(favicon).not.toContain('<rect')

      const embeddedPng = favicon.match(/data:image\/png;base64,([^"']+)/)?.[1]
      expect(embeddedPng).toBeDefined()
      expect([...Buffer.from(embeddedPng!, 'base64').subarray(0, 8)]).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ])
    }

    const fallbackFavicon = readFileSync(resolve(process.cwd(), 'public/favicon.ico'))
    expect([...fallbackFavicon.subarray(0, 4)]).toEqual([0, 0, 1, 0])
  })

  it('injects a trusted request path and overwrites a spoofed client header', async () => {
    vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'false')
    const request = new NextRequest('https://pika.example/teacher/calendar?view=month', {
      headers: { [PIKA_REQUEST_PATH_HEADER]: '/evil' },
    })

    const response = await middleware(request)

    expect(response.headers.get(`x-middleware-request-${PIKA_REQUEST_PATH_HEADER}`))
      .toBe('/teacher/calendar?view=month')
    expect(workOSMocks.authkit).not.toHaveBeenCalled()
  })

  it('preserves AuthKit response headers while forwarding the trusted request path', async () => {
    vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'true')
    const request = new NextRequest('https://pika.example/student/history?month=8')
    workOSMocks.authkit.mockResolvedValue({ headers: new Headers() })
    workOSMocks.partitionAuthkitHeaders.mockReturnValue({
      requestHeaders: new Headers(request.headers),
      responseHeaders: new Headers({ 'set-cookie': 'pika-wos-session=refreshed; Path=/' }),
    })

    const response = await middleware(request)

    expect(response.headers.get(`x-middleware-request-${PIKA_REQUEST_PATH_HEADER}`))
      .toBe('/student/history?month=8')
    expect(response.headers.get('set-cookie')).toContain('pika-wos-session=refreshed')
  })
})
