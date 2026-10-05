import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(`supabase/migrations/${name}`, 'utf8')
const metadata = read('237_contextual_classroom_metadata_owner_write.sql')
const removal = read('236_contextual_roster_removal_owner_write.sql')
const forward = read('238_contextual_owner_write_forward_corrections.sql')

describe('immutable owner-write migration forward corrections', () => {
  it('preserves both previously installed definitions byte for byte', () => {
    expect(createHash('sha256').update(removal).digest('hex')).toBe('24e23667b21580fdcadb7a64ca251725f87040fa52bf9a1fbe71e0c7b3c22249')
    expect(createHash('sha256').update(metadata).digest('hex')).toBe('f61ec76016a13c2b2e5fd22f765857304d5798617cf96fc0720585fff699d883')
  })
  it('changes only private validator volatility and the locked effective-publication guard', () => {
    const expected = metadata
      .replace('-- PRIVATE SOURCE DRAFT. Migration number/application/types are coordinator-owned.\n-- Metadata only: no ownership, lifecycle, position, plan or enrollment writes.', '-- Forward-only corrections for immutable migrations 236 and 237.\n-- Preserve private validator body/ACL and metadata signature, locks and postconditions.')
      .replace('begin;\n', 'begin;\n\n-- to_jsonb(anyelement) is STABLE; the validator must match its call graph.\nalter function private.valid_roster_removal_result_v1(jsonb,uuid,uuid,uuid[]) stable;\n')
      .replace('create function public.update_classroom_metadata_for_owner_v1(', 'create or replace function public.update_classroom_metadata_for_owner_v1(')
      .replace('v_expected.actual_site_published and v_expected.actual_site_slug is null', "v_expected.actual_site_published and nullif(v_expected.actual_site_slug, '') is null")
    expect(forward).toBe(expected)
    expect(forward.indexOf('v_expected := jsonb_populate_record')).toBeLessThan(forward.indexOf('nullif(v_expected.actual_site_slug'))
    expect(forward.indexOf('nullif(v_expected.actual_site_slug')).toBeLessThan(forward.indexOf('update public.classrooms classroom set'))
  })
  it('requires the actual corrected catalog declaration in the rollback-only roster proof', () => {
    const proof = readFileSync('scripts/check-contextual-roster-removal-owner-writes-database.sql', 'utf8')
    expect(proof).toContain("schema_migrations where version='238'")
    expect(proof).toContain("'private.valid_roster_removal_result_v1(jsonb,uuid,uuid,uuid[])'::regprocedure) is distinct from 's'")
  })
  it('executes the dormant metadata dependency regression without importing its app flow', () => {
    const proof = readFileSync('scripts/check-contextual-classroom-metadata-database.sql', 'utf8')
    expect(proof).toContain("actual_site_slug='',actual_site_published=false")
    expect(proof).toContain("pg_temp.expect_metadata_error(owner_a,a,'{\"actual_site_published\":true}','PT400')")
    expect(proof).toContain('Metadata/archive/Blueprint state did not roll back')
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
    expect(ci).toContain('bash scripts/check-contextual-classroom-metadata-database.sh')
    expect(ci).toContain('supabase db lint --local --level warning --fail-on warning')
  })
})
