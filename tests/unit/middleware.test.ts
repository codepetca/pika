import { describe, expect, it, vi } from 'vitest'

vi.mock('@workos-inc/authkit-nextjs', () => ({
  authkitMiddleware: vi.fn(),
}))

import { config } from '@/middleware'

const [matcher] = config.matcher
const matchesPath = (pathname: string) => new RegExp(`^${matcher}$`).test(pathname)

describe('AuthKit middleware matcher', () => {
  it('covers app-rendered favicon fallbacks while excluding Next.js static assets', () => {
    expect(matchesPath('/favicon.ico')).toBe(true)
    expect(matchesPath('/classrooms')).toBe(true)
    expect(matchesPath('/_next/static/chunks/app.js')).toBe(false)
    expect(matchesPath('/_next/image')).toBe(false)
  })
})
