import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerPublicationFixture } from '../../scripts/contextual-test-publication-proof-fixture'
import {
  TEST_OWNER_PUBLICATION_DB_CAPS,
  TEST_OWNER_PUBLICATION_DB_CHECK_LABELS,
  TEST_OWNER_PUBLICATION_DB_LIMITATIONS,
  TEST_OWNER_PUBLICATION_DRAFT_COLUMNS,
  TEST_OWNER_PUBLICATION_QUESTION_COLUMNS,
  TEST_OWNER_PUBLICATION_SOURCE_SHA256,
  TEST_OWNER_PUBLICATION_TEST_COLUMNS,
  testOwnerPublicationDbContractsManifest,
  runTestOwnerPublicationDbContracts,
} from '../../scripts/contextual-test-publication-db-contracts'
import type { DraftSaveDriver, DraftSaveTarget } from '../../scripts/check-contextual-test-draft-save-db-contracts'

const f = newTestOwnerPublicationFixture(newAssignmentListProofFixture(new Date('2026-10-06T12:00:00Z')))
const project = `pika_assignment_list_${f.tag.slice(-12)}`
const manifest = testOwnerPublicationDbContractsManifest(f, project)

describe('contextual Test publication rollback database contracts', () => {
  it('is inert, finite, rollback-only and source-pinned', () => {
    expect(TEST_OWNER_PUBLICATION_SOURCE_SHA256).toMatch(/^[a-f0-9]{64}$/)
    expect(TEST_OWNER_PUBLICATION_DB_CAPS).toEqual({ sqlBytes: 256 * 1024, actionMs: 35_000, requestMs: 12_000 })
    expect(Buffer.byteLength(manifest.contracts)).toBeLessThanOrEqual(TEST_OWNER_PUBLICATION_DB_CAPS.sqlBytes)
    expect(manifest.contracts.trimStart()).toMatch(/^begin;/i)
    expect(manifest.contracts.trimEnd()).toMatch(/rollback;$/i)
    expect(manifest.contracts).not.toMatch(/\bcommit\s*;|truncate\s|setval\s*\(|reset\s+.*sequence/i)
    expect(manifest.contracts.match(/\bas result\b/gi)).toHaveLength(1)
    expect(manifest.sourceSha256).toBe(TEST_OWNER_PUBLICATION_SOURCE_SHA256)
    expect(Object.isFrozen(manifest)).toBe(true)
  })

  it('attests the complete physical Test, Draft, and question rows plus closed catalog', () => {
    expect(TEST_OWNER_PUBLICATION_TEST_COLUMNS).toHaveLength(21)
    expect(TEST_OWNER_PUBLICATION_DRAFT_COLUMNS).toHaveLength(10)
    expect(TEST_OWNER_PUBLICATION_QUESTION_COLUMNS).toHaveLength(21)
    for (const token of [
      'publish_test_from_draft_for_owner_v1(uuid,uuid,uuid,text,integer,jsonb,timestamp with time zone)',
      'publish_test_from_draft_atomic(uuid,uuid,integer)',
      'activate_test_from_draft_atomic(uuid,uuid,integer)',
      'snapshot_test_draft_for_owner_v1(uuid,uuid,timestamp with time zone)',
      'prosecdef', 'search_path=""', 'lock_timeout=1s',
      'has_function_privilege', 'pg_catalog.aclexplode', 'tgenabled', 'tgdeferrable',
      'Exact Test trigger closure differs', 'Exact Draft trigger closure differs',
      'Exact question trigger closure differs',
    ]) expect(manifest.contracts).toContain(token)
    expect(TEST_OWNER_PUBLICATION_QUESTION_COLUMNS).toEqual(['id','test_id','question_type','question_text','options','correct_option',
      'points','response_max_chars','position','created_at','updated_at','response_monospace','answer_key','ai_reference_cache_key',
      'ai_reference_cache_answers','ai_reference_cache_model','ai_reference_cache_generated_at','sample_solution','artifact_id',
      'source_artifact_id','source_blueprint_version_id'])
    expect(manifest.contracts).toContain('pg_catalog.cardinality(p.proconfig)<>2')
    expect(manifest.contracts).not.toContain("'statement_timeout=8s'")
  })

  it('seals rollback probes for authorization, CAS, materialization, blockers and drift', () => {
    for (const label of TEST_OWNER_PUBLICATION_DB_CHECK_LABELS) expect(manifest.contracts).toContain(label)
    for (const c of f.cases) {
      expect(manifest.contracts).toContain(c.label)
      expect(manifest.contracts).toContain(c.actorId)
      expect(manifest.contracts).toContain(c.testId)
    }
    for (const token of [
      'source_sha256', 'p_validated_content', 'question_identity_version', 'source_artifact_id',
      'ai_reference_cache_key', 'classroom_guided_draft_provenance', 'managed_storage_json_references',
      'test_document_snapshot_storage_cleanup',
      'gradebook_score_overrides', 'test_attempts', 'test_responses', 'test_focus_events',
      'test_student_availability', 'test_ai_grading_runs', 'test_ai_grading_run_items',
      'blueprint_source_revision', 'classroom_archive_revisions',
      "code<>'PT409'", "code is distinct from 'PT503'", "errcode='42501'",
    ]) expect(manifest.contracts).toContain(token)
    expect(TEST_OWNER_PUBLICATION_DB_LIMITATIONS.join(' ')).toMatch(/wrong-Class.*no-FK/i)
    expect(manifest.contracts.match(/create temp sequence p252_/g)?.length).toBeGreaterThanOrEqual(19)
    expect(manifest.contracts).toContain('Publication fault trigger was not reached')
    expect(manifest.contracts).toContain('owner_publication_baseline')
    expect(manifest.contracts).toContain('select value into strict baseline_graph')
    expect(manifest.contracts).toContain("raise exception using errcode='42501',message='publication raw privilege probe'")
    expect(manifest.contracts).toContain("raise exception using errcode='55000',message='publication unknown probe'")
    expect(manifest.contracts).not.toMatch(/perform '(?:test_attempts|test_responses|classroom_guided_draft_provenance)'/)
  })

  it('returns only closed labels and bounded non-secret evidence', () => {
    expect(TEST_OWNER_PUBLICATION_DB_CHECK_LABELS.length).toBeGreaterThanOrEqual(30)
    expect(manifest.expectedResult).toEqual({ version: 1, checks: [...TEST_OWNER_PUBLICATION_DB_CHECK_LABELS].sort(), rolledBack: true })
    expect(manifest.contracts).toContain("jsonb_build_object('version',1,'checks'")
    expect(manifest.contracts).not.toMatch(/raise\s+(?:notice|log|warning)|current_query\(\)|pg_read_file/i)
  })

  it('emits one grouped catalog code and only the later per-probe codes', () => {
    const emitted = [...new Set([...manifest.contracts.matchAll(/errcode='(P25\d{2})'/g)].map(match => match[1]))].sort()
    expect(emitted).toEqual(['P2501', ...Array.from({ length: 42 }, (_, index) => `P25${String(index + 7).padStart(2, '0')}`)])
  })

  it('runs only the accepted bundle and always closes its exact session', async () => {
    const acceptedManifestSha256=createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
    const target=Object.freeze({projectId:project,apiUrl:'http://127.0.0.1:54331',databaseHost:'127.0.0.1',databasePort:54332,
      containerId:'a'.repeat(64),containerProjectLabel:project,disposable:true as const,reviewedHead:'b'.repeat(40),migrationManifestSha256:'c'.repeat(64),
      reviewedSourceSha256:TEST_OWNER_PUBLICATION_SOURCE_SHA256,acceptedManifestSha256}) satisfies DraftSaveTarget
    let closed=0;const driver:DraftSaveDriver={verifyTarget:async()=>target,openSession:async name=>({name,
      execute:async(sql,timeout)=>{expect(sql).toBe(manifest.contracts);expect(timeout).toBe(35_000);return [{result:manifest.expectedResult}]},
      rollbackAndClose:async()=>{closed++}})}
    await expect(runTestOwnerPublicationDbContracts(manifest,target,driver)).resolves.toMatchObject({kind:'rollback-test-owner-publication-contracts',checks:manifest.expectedResult.checks})
    expect(closed).toBe(1)
  })
})
