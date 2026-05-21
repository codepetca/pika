import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION_FILENAME_PATTERN = /^[0-9]{3}_[a-z0-9_]+\.sql$/

function migrationFilenames(): string[] {
  return readdirSync(resolve(process.cwd(), 'supabase/migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()
}

describe('Supabase migration filenames', () => {
  it('uses Pika numeric snake-case migration filenames', () => {
    const invalid = migrationFilenames().filter(
      (file) => !MIGRATION_FILENAME_PATTERN.test(file)
    )

    expect(invalid).toEqual([])
  })

  it('uses unique contiguous migration numbers', () => {
    const prefixes = migrationFilenames().map((file) => Number(file.slice(0, 3)))
    const duplicates = prefixes.filter((prefix, index) => prefixes.indexOf(prefix) !== index)
    const expected = Array.from({ length: prefixes.length }, (_, index) => index + 1)

    expect(duplicates).toEqual([])
    expect(prefixes).toEqual(expected)
  })
})
