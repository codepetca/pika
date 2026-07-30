import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/119_hot_archived_classroom_purge_canonical_path_matching.sql',
  'utf8',
)

describe('hot archived classroom purge canonical path migration', () => {
  it('decodes URL percent escapes as UTF-8 bytes and fails closed on invalid input', () => {
    expect(migration).toContain(
      'create or replace function public.classroom_purge_percent_decode',
    )
    expect(migration).toContain("substr(p_value, v_index + 1, 2) ~ '^[0-9A-Fa-f]{2}$'")
    expect(migration).toContain("v_bytes := v_bytes || decode(v_hex, 'hex')")
    expect(migration).toContain("return convert_from(v_bytes, 'UTF8')")
    expect(migration).toContain('when others then')
    expect(migration).toContain('return null')
  })

  it('extracts decoded JSON string scalars rather than searching serialized JSON', () => {
    expect(migration).toContain(
      'create or replace function public.classroom_purge_jsonb_text_values',
    )
    expect(migration).toContain(
      `'strict $.** ? (@.type() == "string")'::jsonpath`,
    )
    expect(migration).toContain('select value #>>')
  })

  it('matches raw and once-percent-decoded scalar values', () => {
    const matcher = migration.indexOf(
      'create or replace function public.classroom_purge_jsonb_references_storage_path',
    )
    const rawMatch = migration.indexOf(
      'strpos(candidate.value, p_storage_path) > 0',
      matcher,
    )
    const decodedMatch = migration.indexOf(
      'public.classroom_purge_percent_decode(candidate.value)',
      rawMatch,
    )

    expect(matcher).toBeGreaterThanOrEqual(0)
    expect(rawMatch).toBeGreaterThan(matcher)
    expect(decodedMatch).toBeGreaterThan(rawMatch)
  })

  it('uses canonical matching for both sharing scans and write reservations', () => {
    const sharing = migration.indexOf(
      'create or replace function public.classroom_purge_storage_path_is_shared',
    )
    const trigger = migration.indexOf(
      'create or replace function public.reject_reserved_classroom_purge_storage_reference',
    )

    expect(sharing).toBeGreaterThanOrEqual(0)
    expect(migration.indexOf(
      'public.classroom_purge_jsonb_references_storage_path(',
      sharing,
    )).toBeGreaterThan(sharing)
    expect(trigger).toBeGreaterThan(sharing)
    expect(migration.indexOf(
      'public.classroom_purge_jsonb_references_storage_path(',
      trigger,
    )).toBeGreaterThan(trigger)
    expect(migration).not.toContain('strpos(v_payload, object.storage_path)')
  })

  it('keeps canonical helpers private and the trigger security-definer scoped', () => {
    expect(migration).toMatch(
      /create or replace function public\.reject_reserved_classroom_purge_storage_reference\(\)[\s\S]*?security definer[\s\S]*?set search_path = public/,
    )
    for (const signature of [
      'classroom_purge_percent_decode(text)',
      'classroom_purge_jsonb_text_values(jsonb)',
      'classroom_purge_jsonb_references_storage_path(jsonb, text)',
    ]) {
      expect(migration).toContain(
        `revoke all on function public.${signature}`,
      )
    }
  })
})
