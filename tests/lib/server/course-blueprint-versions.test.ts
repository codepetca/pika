import { describe, expect, it } from 'vitest'
import {
  buildCourseBlueprintSnapshot,
  canonicalizeCourseBlueprintSnapshot,
  hashCourseBlueprintSnapshot,
} from '@/lib/server/course-blueprint-versions'
import type { CourseBlueprintDetail } from '@/types'

const detail = {
  id: '10000000-0000-4000-8000-000000000000',
  teacher_id: '20000000-0000-4000-8000-000000000000',
  content_revision: 3,
  title: 'Course',
  subject: 'CS',
  grade_level: '11',
  course_code: 'ICS3U',
  term_template: 'Semester',
  overview_markdown: 'Overview',
  outline_markdown: 'Outline',
  resources_markdown: 'Resources',
  gradebook_use_weights: false,
  gradebook_assignments_weight: 70,
  gradebook_tests_weight: 30,
  planned_site_slug: 'course',
  planned_site_published: false,
  planned_site_config: {
    overview: true,
    outline: true,
    resources: true,
    assignments: true,
    tests: true,
    lesson_plans: true,
  },
  position: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  assignments: [{
    id: '30000000-0000-4000-8000-000000000000',
    artifact_id: '31000000-0000-4000-8000-000000000000',
    course_blueprint_id: '10000000-0000-4000-8000-000000000000',
    title: 'Assignment',
    instructions_markdown: 'Do it.',
    submission_requirements_json: [],
    default_due_days: 4,
    default_due_time: '23:59',
    points_possible: 10,
    gradebook_weight: 10,
    include_in_final: true,
    is_draft: true,
    track_authenticity: true,
    position: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  }],
  assessments: [],
  lesson_templates: [],
  materials: [],
  surveys: [],
  linked_classrooms: [],
} satisfies CourseBlueprintDetail

describe('immutable course blueprint versions', () => {
  it('excludes database and teacher bookkeeping from canonical snapshots', () => {
    const first = buildCourseBlueprintSnapshot(detail)
    const changedBookkeeping = structuredClone(detail)
    changedBookkeeping.teacher_id = '90000000-0000-4000-8000-000000000000'
    changedBookkeeping.assignments[0].id = '80000000-0000-4000-8000-000000000000'
    changedBookkeeping.updated_at = '2026-06-01T00:00:00Z'
    changedBookkeeping.assignments[0].updated_at = '2026-06-01T00:00:00Z'
    const second = buildCourseBlueprintSnapshot(changedBookkeeping)

    expect(canonicalizeCourseBlueprintSnapshot(first)).toBe(
      canonicalizeCourseBlueprintSnapshot(second)
    )
    expect(first.assignments[0]?.artifact_id).toBe(
      '31000000-0000-4000-8000-000000000000'
    )
    expect(first).not.toHaveProperty('teacher_id')
    expect(first.assignments[0]).not.toHaveProperty('id')
    expect(first.assignments[0]?.track_authenticity).toBe(true)
  })

  it('changes the digest for reusable content edits while preserving lineage', () => {
    const first = buildCourseBlueprintSnapshot(detail)
    const renamed = structuredClone(detail)
    renamed.assignments[0].title = 'Renamed assignment'
    renamed.content_revision = 4
    const second = buildCourseBlueprintSnapshot(renamed)

    expect(second.assignments[0]?.artifact_id).toBe(
      first.assignments[0]?.artifact_id
    )
    expect(hashCourseBlueprintSnapshot(second)).not.toBe(
      hashCourseBlueprintSnapshot(first)
    )
  })
})
