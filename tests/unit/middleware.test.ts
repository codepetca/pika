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
    expect(matchesPath('/icon.svg')).toBe(false)
    expect(matchesPath('/iconXsvg')).toBe(true)
    expect(matchesPath('/icon.svg/anything')).toBe(true)
    expect(matchesPath('/classrooms')).toBe(true)
    expect(matchesPath('/_next/static/chunks/app.js')).toBe(false)
    expect(matchesPath('/_next/static')).toBe(false)
    expect(matchesPath('/_next/staticx')).toBe(true)
    expect(matchesPath('/_next/image')).toBe(false)
    expect(matchesPath('/_next/image/transform')).toBe(false)
    expect(matchesPath('/_next/imageevil')).toBe(true)

    const favicon = readFileSync(resolve(process.cwd(), 'src/app/icon.svg'), 'utf8')
    expect(favicon).toContain('@media (prefers-color-scheme: dark)')
    expect(favicon).toContain('filter: invert(1)')
    expect(favicon).not.toContain('<rect')

    const embeddedPng = favicon.match(/data:image\/png;base64,([^"']+)/)?.[1]
    expect(embeddedPng).toBeDefined()
    expect([...Buffer.from(embeddedPng!, 'base64').subarray(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ])

    const fallbackFavicon = readFileSync(resolve(process.cwd(), 'public/favicon.ico'))
    expect([...fallbackFavicon.subarray(0, 4)]).toEqual([0, 0, 1, 0])
  })
})
