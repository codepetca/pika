import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { createOfflineTestLearnerRepository } from '../helpers/test-learner-native-repository'
import { GRADEBOOK_ZERO_WEIGHT_STUDENT_VISIBILITY_REVIEWED_MIGRATION, validateGradebookZeroWeightStudentVisibilityReviewedMigration } from '../../scripts/gradebook-zero-weight-student-visibility-reviewed-migration'

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, copyFileSync: vi.fn(actual.copyFileSync) }
})

const sql = readFileSync('supabase/migrations/266_gradebook_zero_weight_student_visibility.sql', 'utf8')
const evidence = { ...GRADEBOOK_ZERO_WEIGHT_STUDENT_VISIBILITY_REVIEWED_MIGRATION, sql }
describe('fixed Gradebook student zero-weight visibility migration seal', () => {
  it('accepts the exact reviewed filename, stored hash and raw SQL bytes', () => {
    expect(() => validateGradebookZeroWeightStudentVisibilityReviewedMigration(evidence)).not.toThrow()
  })
  it.each(['name', 'digest', 'bytes', 'self-hashed-bytes'])('refuses altered %s', defect => {
    const candidate = { ...evidence }
    if (defect === 'name') candidate.name = '266_unknown.sql'
    if (defect === 'digest') candidate.sha256 = 'f'.repeat(64)
    if (defect === 'bytes' || defect === 'self-hashed-bytes') candidate.sql += '\n'
    if (defect === 'self-hashed-bytes') candidate.sha256 = createHash('sha256').update(candidate.sql).digest('hex')
    expect(() => validateGradebookZeroWeightStudentVisibilityReviewedMigration(candidate)).toThrow()
  })
})

// The metadata function must retain all unrelated forward corrections and guards.
it('changes only the visibility validation and old-client preservation from the latest metadata owner', () => {
  const previous = readFileSync('supabase/migrations/238_contextual_owner_write_forward_corrections.sql', 'utf8')
  const body = (source: string) => source.slice(source.indexOf('create or replace function public.update_classroom_metadata_for_owner_v1'), source.indexOf('\nrevoke all on function public.update_classroom_metadata_for_owner_v1'))
  const compatible = body(sql)
    .replace("if not (v_value ?& array['attendance','classwork','tests','gradebook','student_grades','calendar','syllabus','announcements','achievements']) or exists (", "if (select count(*) from jsonb_object_keys(v_value)) <> 9 or exists (")
    .replace(",'gradebook_hide_zero_weight_student'", '')
    .replace(/  -- An older client may update the feature flags without knowing this setting\.[\s\S]*?  end if;\n/, '')
  expect(compatible).toBe(body(previous))
})

it('validates the current tail before copying a historical offline learner prefix', () => {
  const inventory = platform.loadAssignmentListReviewedMigrations(process.cwd()).map(migration => ({ ...migration }))
  inventory[265].sql += '\n'
  inventory[265].sha256 = createHash('sha256').update(inventory[265].sql).digest('hex')
  const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(inventory)
  const copy = vi.spyOn(fs, 'copyFileSync')
  try {
    expect(() => createOfflineTestLearnerRepository(process.cwd())).toThrow()
    expect(copy).not.toHaveBeenCalled()
  } finally { loader.mockRestore(); copy.mockRestore() }
})
