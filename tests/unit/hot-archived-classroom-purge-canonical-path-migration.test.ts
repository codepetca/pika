import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/117_hot_archived_classroom_purge_review_hardening.sql',
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

  it('matches raw, canonical encoded, and WHATWG-normalized URL values', () => {
    const matcher = migration.indexOf(
      'create or replace function public.classroom_purge_jsonb_references_storage_path',
    )
    const rawMatch = migration.indexOf(
      'strpos(candidate.value, p_storage_path) > 0',
      matcher,
    )
    const encodedMatch = migration.indexOf(
      'public.classroom_purge_percent_encode_path(p_storage_path)',
      rawMatch,
    )
    const normalizedUrlMatch = migration.indexOf(
      'public.classroom_purge_normalize_special_url_path(url.value)',
      encodedMatch,
    )

    expect(matcher).toBeGreaterThanOrEqual(0)
    expect(rawMatch).toBeGreaterThan(matcher)
    expect(encodedMatch).toBeGreaterThan(rawMatch)
    expect(normalizedUrlMatch).toBeGreaterThan(encodedMatch)
  })

  it('uses canonical matching for both sharing scans and write reservations', () => {
    const sharing = migration.indexOf(
      'create or replace function public.classroom_purge_storage_path_is_shared',
    )
    const matcher = migration.indexOf(
      'create or replace function public.classroom_purge_jsonb_references_storage_path',
      sharing,
    )
    const trigger = migration.indexOf(
      'create or replace function public.reject_reserved_classroom_purge_storage_reference',
      matcher,
    )
    const triggerInstall = migration.indexOf(
      'execute function public.reject_reserved_classroom_purge_storage_reference()',
      trigger,
    )
    const triggerRevoke = migration.indexOf(
      'revoke all on function public.reject_reserved_classroom_purge_storage_reference()',
    )
    const triggerComment = migration.indexOf(
      'comment on function public.reject_reserved_classroom_purge_storage_reference()',
    )

    expect(sharing).toBeGreaterThanOrEqual(0)
    expect(migration.indexOf(
      'public.classroom_purge_jsonb_references_storage_path(',
      sharing,
    )).toBeGreaterThan(sharing)
    expect(matcher).toBeGreaterThan(sharing)
    expect(trigger).toBeGreaterThan(matcher)
    expect(migration.indexOf(
      'public.classroom_purge_jsonb_references_storage_path(',
      trigger,
    )).toBeGreaterThan(trigger)
    expect(triggerInstall).toBeGreaterThan(trigger)
    expect(triggerRevoke).toBeGreaterThan(triggerInstall)
    expect(triggerComment).toBeGreaterThan(triggerRevoke)
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
