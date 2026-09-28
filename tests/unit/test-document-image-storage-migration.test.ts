import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/208_allow_test_document_png_jpeg.sql'),
  'utf8',
)

describe('test document image bucket migration', () => {
  it('adds only PNG and JPEG to the existing Test document allowlist', () => {
    expect(migration).toMatch(/where id = 'test-documents'/i)
    expect(migration).toMatch(/array\['image\/png', 'image\/jpeg'\]/i)
    expect(migration).toContain('allowed_mime_types ||')
    expect(migration).not.toContain('image/svg+xml')
  })

  it('preserves an unrestricted bucket allowlist instead of replacing it', () => {
    expect(migration).toMatch(/when allowed_mime_types is null then null/i)
  })
})
