import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { v1 } from '@/vendor/pal-contract'

const fixtureRoot = resolve(process.cwd(), 'tests/fixtures/pal-contract-v1')

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

describe('vendored Pal v1 contract', () => {
  it('accepts every canonical valid fixture', () => {
    const fixtureNames = readdirSync(resolve(fixtureRoot, 'valid')).sort()

    for (const fixtureName of fixtureNames) {
      const result = v1.validateV1Event(
        readJson(resolve(fixtureRoot, 'valid', fixtureName)),
      )
      expect(result, fixtureName).toMatchObject({ ok: true })
    }
  })

  it('rejects every canonical invalid fixture with the canonical error', () => {
    const manifest = readJson(
      resolve(fixtureRoot, 'invalid', 'manifest.json'),
    ) as { cases: Record<string, { error: v1.V1Error }> }

    for (const [fixtureName, fixture] of Object.entries(manifest.cases)) {
      const result = v1.validateV1Event(
        readJson(resolve(fixtureRoot, 'invalid', fixtureName)),
      )
      expect(result, fixtureName).toMatchObject({
        ok: false,
        error: fixture.error,
      })
    }
  })
})
