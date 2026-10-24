import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
import { validateLifecycleServicesReviewedMigrations } from '../../scripts/lifecycle-services-reviewed-migrations'
import { TEACHER_AUTHORING_IMAGES_REVIEWED_MIGRATION, validateTeacherAuthoringImagesReviewedMigration } from '../../scripts/teacher-authoring-images-reviewed-migration'
import { teacherAuthoringImageTriggerRowsSql, teacherAuthoringImagesCatalogSql, TEACHER_AUTHORING_IMAGE_TRIGGER_PAIRS,
  TEACHER_AUTHORING_IMAGE_ROUTINE_MD5 } from '../../scripts/teacher-authoring-images-proof-catalog'
import { classroomTestQuotaProofCatalog } from '../../scripts/classroom-test-quota-proof-catalog'

const sql = readFileSync(`supabase/migrations/${TEACHER_AUTHORING_IMAGES_REVIEWED_MIGRATION.name}`, 'utf8')
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

// Offline source checks only. No adapter, SQL engine, SDK or native runner is invoked.
describe('additive291 source and exact catalog admission', () => {
  it('binds final source bytes and every new routine body independently', () => {
    const migration = { name: TEACHER_AUTHORING_IMAGES_REVIEWED_MIGRATION.name, sql, sha256: sha256(sql) }
    expect(() => validateTeacherAuthoringImagesReviewedMigration(migration)).not.toThrow()
    for (const [name, digest] of Object.entries(TEACHER_AUTHORING_IMAGE_ROUTINE_MD5)) {
      const body = sql.match(new RegExp(`(?:create or replace|create) function public\\.${name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`))?.[1]
      expect(body).toBeDefined()
      expect(createHash('md5').update(body!).digest('hex')).toBe(digest)
    }
  })

  it('keeps historical source prefixes and rejects an unknown293 tail', () => {
    const migrations = loadAssignmentListReviewedMigrations(process.cwd())
    expect(migrations).toHaveLength(292)
    for (const count of [281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291]) {
      expect(() => validateLifecycleServicesReviewedMigrations(migrations.slice(0, count))).not.toThrow()
    }
    expect(() => validateLifecycleServicesReviewedMigrations(migrations)).not.toThrow()
    expect(() => validateLifecycleServicesReviewedMigrations([...migrations, { name: '293_unknown.sql', sql: 'select 1;', sha256: sha256('select 1;') }])).toThrow()
    const changed = migrations.map((entry) => ({ ...entry }))
    changed[290].sql += '\n'
    changed[290].sha256 = sha256(changed[290].sql)
    expect(() => classroomTestQuotaProofCatalog(['public.tests'], changed)).toThrow()
  })

  it('adds only named291 triggers when the ledger exists and preserves empty historical admission', () => {
    expect(TEACHER_AUTHORING_IMAGE_TRIGGER_PAIRS).toHaveLength(7)
    const rows = teacherAuthoringImageTriggerRowsSql(['tests', 'assessment_drafts'], true)
    expect(rows).toContain("'tests'::text,'tests_authoring_image_references'::text,'public'::text,'sync_teacher_authoring_image_references'::text,29")
    expect(rows).toContain("'assessment_drafts'::text,'assessment_drafts_authoring_image_references'::text")
    expect(rows.match(/where pg_catalog.to_regclass\('public.teacher_authoring_image_references'\) is not null/g)).toHaveLength(2)
    const guards = teacherAuthoringImagesCatalogSql()
    for (const token of ['Partial authoring291 catalog differs', 'Authoring291 reference ledger capability differs',
      'Authoring291 trigger routine capability differs', 'Authoring291 liveness routine differs',
      "t.tgtype<>29", "t.tgattr::text<>''", 't.tgqual is not null', 't.tgnargs<>0',
      't.tgdeferrable and t.tginitdeferred', "a.privilege_type<>'SELECT'", 'pg_catalog.md5(authoring_proc.prosrc)',
      "array['search_path=\"\"']::text[]", "'removed_teacher_authoring_image_cleanup'"]) expect(guards).toContain(token)
  })

  it.each(['owner-create', 'publication', 'pristine-discard', 'reorder'])('extends %s without filtering historical trigger closures', (owner) => {
    const source = readFileSync(`scripts/contextual-test-${owner}-db-contracts.ts`, 'utf8')
    expect(source).toContain('teacherAuthoringImagesCatalogSql()')
    expect(source).toContain('teacherAuthoringImageTriggerRowsSql(')
    expect(source).toContain('except (')
    expect(source).toContain('not t.tgisinternal')
    expect(source).not.toMatch(/tgname\s*(?:<>|not in).*authoring/i)
  })
})
