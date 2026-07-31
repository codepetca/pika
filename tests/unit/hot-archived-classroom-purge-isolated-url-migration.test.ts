import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/117_hot_archived_classroom_purge_review_hardening.sql',
  'utf8',
)

describe('hot archived classroom purge isolated URL migration', () => {
  it('encodes UTF-8 path bytes while preserving canonical path separators', () => {
    expect(migration).toContain(
      'create or replace function public.classroom_purge_percent_encode_path',
    )
    expect(migration).toContain("v_bytes bytea := convert_to(p_value, 'UTF8')")
    expect(migration).toContain('v_byte in (33, 39, 40, 41, 42, 45, 46, 47, 95, 126)')
    expect(migration).toContain(
      "v_result := v_result || '%' || upper(lpad(to_hex(v_byte), 2, '0'))",
    )
  })

  it('normalizes valid escapes without decoding or rejecting unrelated text', () => {
    const normalizer = migration.indexOf(
      'create or replace function public.classroom_purge_normalize_percent_escapes',
    )
    const upper = migration.indexOf(
      "v_result := v_result || '%' || upper(v_hex)",
      normalizer,
    )

    expect(normalizer).toBeGreaterThanOrEqual(0)
    expect(upper).toBeGreaterThan(normalizer)
    expect(migration.slice(normalizer, upper)).not.toContain('convert_from')
    expect(migration.slice(normalizer, upper)).not.toContain('return null')
  })

  it('isolates URL candidates before using the compatibility decoder', () => {
    expect(migration).toContain(
      'create or replace function public.classroom_purge_url_candidates',
    )
    expect(migration).toContain(
      "regexp_matches(p_value, '(https?://[^[:space:]]+)', 'gi')",
    )

    const matcher = migration.lastIndexOf(
      'create or replace function public.classroom_purge_jsonb_references_storage_path',
    )
    const urls = migration.indexOf(
      'public.classroom_purge_url_candidates(candidate.value)',
      matcher,
    )
    const normalizer = migration.indexOf(
      'public.classroom_purge_normalize_special_url_path(url.value)',
      urls,
    )
    const matcherEnd = migration.indexOf('$$;', matcher)

    expect(matcher).toBeGreaterThanOrEqual(0)
    expect(urls).toBeGreaterThan(matcher)
    expect(normalizer).toBeGreaterThan(urls)
    expect(migration.slice(matcher, matcherEnd)).not.toContain(
      'public.classroom_purge_percent_decode(candidate.value)',
    )
  })

  it('compares normalized field text with the canonical encoded path', () => {
    expect(migration).toContain(
      'public.classroom_purge_normalize_percent_escapes(candidate.value)',
    )
    expect(migration).toContain(
      'public.classroom_purge_percent_encode_path(p_storage_path)',
    )
    expect(migration).toContain('strpos(candidate.value, p_storage_path) > 0')
  })

  it('keeps every new canonicalization helper private', () => {
    for (const signature of [
      'classroom_purge_percent_encode_path(text)',
      'classroom_purge_normalize_percent_escapes(text)',
      'classroom_purge_url_candidates(text)',
      'classroom_purge_jsonb_references_storage_path(jsonb, text)',
    ]) {
      expect(migration).toContain(
        `revoke all on function public.${signature}`,
      )
    }
  })
})
