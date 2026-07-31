import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/117_hot_archived_classroom_purge_review_hardening.sql',
  'utf8',
)

describe('hot archived classroom purge URL path isolation migration', () => {
  it('removes fragment and query data from each URL candidate', () => {
    const fragmentSplit = migration.indexOf(
      "split_part(matched[1], '#', 1)",
    )
    const querySplit = migration.indexOf("'?'", fragmentSplit)

    expect(fragmentSplit).toBeGreaterThanOrEqual(0)
    expect(querySplit).toBeGreaterThan(fragmentSplit)
    expect(migration).toContain(
      "regexp_matches(p_value, '(https?://[^[:space:]]+)', 'gi') matched",
    )
  })

  it('normalizes WHATWG special-URL backslashes and dot segments', () => {
    const normalizer = migration.indexOf(
      'create or replace function public.classroom_purge_normalize_special_url_path',
    )

    expect(normalizer).toBeGreaterThanOrEqual(0)
    expect(migration.indexOf("E'\\\\'", normalizer)).toBeGreaterThan(normalizer)
    expect(migration.indexOf(
      "v_decoded_segment = '.'",
      normalizer,
    )).toBeGreaterThan(normalizer)
    expect(migration.indexOf(
      "v_decoded_segment = '..'",
      normalizer,
    )).toBeGreaterThan(normalizer)
    expect(migration.indexOf(
      'public.classroom_purge_normalize_special_url_path(url.value)',
      normalizer,
    )).toBeGreaterThan(normalizer)
  })

  it('retains the private security-definer helper contract', () => {
    expect(migration).toMatch(
      /create or replace function public\.classroom_purge_url_candidates\(p_value text\)[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/,
    )
    expect(migration).toContain(
      'revoke all on function public.classroom_purge_url_candidates(text)',
    )
    expect(migration).toContain(
      'revoke all on function public.classroom_purge_normalize_special_url_path(text)',
    )
    expect(migration).toContain('from public, anon, authenticated')
  })

  it('documents that only the storage-key URL portion is decoded downstream', () => {
    expect(migration).toContain(
      'query or fragment escapes cannot poison managed-path decoding',
    )
  })
})
