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
    expect(matchesPath('/classrooms')).toBe(true)
    expect(matchesPath('/_next/static/chunks/app.js')).toBe(false)
    expect(matchesPath('/_next/image')).toBe(false)

    const favicon = readFileSync(resolve(process.cwd(), 'src/app/favicon.ico'))
    expect([...favicon.subarray(0, 4)]).toEqual([0, 0, 1, 0])
  })
})
