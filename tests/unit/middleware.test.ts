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
    expect(matchesPath('/classrooms')).toBe(true)
    expect(matchesPath('/_next/static/chunks/app.js')).toBe(false)
    expect(matchesPath('/_next/static')).toBe(false)
    expect(matchesPath('/_next/staticx')).toBe(true)
    expect(matchesPath('/_next/image')).toBe(false)
    expect(matchesPath('/_next/image/transform')).toBe(false)
    expect(matchesPath('/_next/imageevil')).toBe(true)

    const favicon = readFileSync(resolve(process.cwd(), 'src/app/favicon.ico'))
    expect([...favicon.subarray(0, 4)]).toEqual([0, 0, 1, 0])

    const imageOffset = favicon.readUInt32LE(18)
    const dibHeaderSize = favicon.readUInt32LE(imageOffset)
    const width = favicon.readInt32LE(imageOffset + 4)
    const storedHeight = favicon.readInt32LE(imageOffset + 8)
    const bitsPerPixel = favicon.readUInt16LE(imageOffset + 14)
    const pixelData = favicon.subarray(
      imageOffset + dibHeaderSize,
      imageOffset + dibHeaderSize + width * (storedHeight / 2) * (bitsPerPixel / 8),
    )
    const hasOpaqueLightPixel = Array.from(
      { length: pixelData.length / 4 },
      (_, pixelIndex) => pixelIndex * 4,
    ).some((offset) => (
      pixelData[offset] > 220
      && pixelData[offset + 1] > 220
      && pixelData[offset + 2] > 220
      && pixelData[offset + 3] > 220
    ))

    expect(bitsPerPixel).toBe(32)
    expect(hasOpaqueLightPixel).toBe(true)
  })
})
