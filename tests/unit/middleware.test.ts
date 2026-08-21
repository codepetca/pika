import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@workos-inc/authkit-nextjs', () => ({
  authkitMiddleware: vi.fn(),
}))

import { config } from '@/middleware'

const [matcher] = config.matcher
const matchesPath = (pathname: string) => new RegExp(`^${matcher}$`).test(pathname)

describe('AuthKit middleware matcher', () => {
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
    expect(layout).toContain("media: '(prefers-color-scheme: light)'")
    expect(layout).toContain("url: '/pika-icon-dark.svg'")
    expect(layout).toContain("media: '(prefers-color-scheme: dark)'")

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
})
