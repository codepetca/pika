import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { createOfflineTestLearnerRepository } from '../helpers/test-learner-native-repository'
import { GRADEBOOK_COMPACT_ZERO_WEIGHT_ASSESSMENTS_REVIEWED_MIGRATION, validateGradebookCompactZeroWeightAssessmentsReviewedMigration } from '../../scripts/gradebook-compact-zero-weight-assessments-reviewed-migration'

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, copyFileSync: vi.fn(actual.copyFileSync) }
})

const sql = readFileSync('supabase/migrations/267_gradebook_compact_zero_weight_assessments.sql', 'utf8')
const evidence = { ...GRADEBOOK_COMPACT_ZERO_WEIGHT_ASSESSMENTS_REVIEWED_MIGRATION, sql }
describe('fixed shared Gradebook zero-weight compaction migration seal', () => {
  it('accepts the exact reviewed filename, stored hash and raw SQL bytes', () => {
    expect(() => validateGradebookCompactZeroWeightAssessmentsReviewedMigration(evidence)).not.toThrow()
  })
  it.each(['name', 'digest', 'bytes', 'self-hashed-bytes'])('refuses altered %s', defect => {
    const candidate = { ...evidence }
    if (defect === 'name') candidate.name = '267_unknown.sql'
    if (defect === 'digest') candidate.sha256 = 'f'.repeat(64)
    if (defect === 'bytes' || defect === 'self-hashed-bytes') candidate.sql += '\n'
    if (defect === 'self-hashed-bytes') candidate.sha256 = createHash('sha256').update(candidate.sql).digest('hex')
    expect(() => validateGradebookCompactZeroWeightAssessmentsReviewedMigration(candidate)).toThrow()
  })
})

// Migration266's own equivalence check retains the238 forward corrections.
it('changes only the optional compaction key and old-client preservation from266', () => {
  const previous = readFileSync('supabase/migrations/266_gradebook_zero_weight_student_visibility.sql', 'utf8')
  const body = (source: string) => source.slice(source.indexOf('create or replace function public.update_classroom_metadata_for_owner_v1'), source.indexOf('\nrevoke all on function public.update_classroom_metadata_for_owner_v1'))
  const compatible = body(sql)
    .replace(",'gradebook_compact_zero_weight_assessments'", '')
    .replace(/  if p_patch \? 'feature_visibility' and not \(p_patch->'feature_visibility' \? 'gradebook_compact_zero_weight_assessments'\) then[\s\S]*?  end if;\n/, '')
  expect(compatible).toBe(body(previous))
  expect(sql).toContain("coalesce(v_before.feature_visibility->'gradebook_compact_zero_weight_assessments', 'true'::jsonb)")
  expect(sql).toContain('revoke all on function public.update_classroom_metadata_for_owner_v1(uuid,uuid,jsonb) from public,anon,authenticated;')
  expect(sql).toContain('grant execute on function public.update_classroom_metadata_for_owner_v1(uuid,uuid,jsonb) to service_role;')
})

it('validates the current tail before copying a historical offline learner prefix', () => {
  const inventory = platform.loadAssignmentListReviewedMigrations(process.cwd()).map(migration => ({ ...migration }))
  inventory[266].sql += '\n'
  inventory[266].sha256 = createHash('sha256').update(inventory[266].sql).digest('hex')
  const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(inventory)
  const copy = vi.spyOn(fs, 'copyFileSync')
  try {
    expect(() => createOfflineTestLearnerRepository(process.cwd())).toThrow()
    expect(copy).not.toHaveBeenCalled()
  } finally { loader.mockRestore(); copy.mockRestore() }
})
