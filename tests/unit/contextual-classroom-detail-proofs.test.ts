import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('classroom-detail SDK tampering proof', () => {
  it('places parsed clones back into the actual wire body before mutating them', () => {
    const source = readFileSync(resolve('scripts/check-contextual-classroom-detail-read.ts'), 'utf8')
    expect(source.includes('body[0] = root\n          options.preflightTamper?.(body, root)')).toBe(true)
    expect(source.includes('body[0] = root\n          options.tamper?.(body, root)')).toBe(true)
  })
})
