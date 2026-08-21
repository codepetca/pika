import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Bara attendance identity documentation', () => {
  it('keeps WorkOS verification local and sends only opaque principal refs', () => {
    const magicAuth = readFileSync(resolve(
      process.cwd(),
      'docs/guidance/workos-magic-auth-pilot.md',
    ), 'utf8')
    const qr = readFileSync(resolve(
      process.cwd(),
      'docs/guidance/pika-attendance-qr-v1.md',
    ), 'utf8')

    expect(magicAuth).toContain('installation-scoped opaque `principal_ref`')
    expect(magicAuth).toContain('Bara receives\nand maps only that opaque ref')
    expect(magicAuth).not.toContain('Bara independently maps that asserted subject')
    expect(qr).toContain('installation-scoped opaque `principal_ref`')
    expect(qr).toContain('Bara receives only that opaque principal ref')
    expect(qr).not.toContain('Bara resolves the teacher subject')
  })
})
