import { describe, expect, it } from 'vitest'
import {
  applyCourseBlueprintChangeProposal,
  buildCourseBlueprintChangeProposal,
  StaleCourseBlueprintProposalError,
} from '@/lib/course-blueprint-change-proposals'
import type { CourseBlueprintSnapshot } from '@/lib/server/course-blueprint-versions'
import { COURSE_BLUEPRINT_SNAPSHOT_SCHEMA_VERSION } from '@/lib/server/course-blueprint-versions'
import { EMPTY_COURSE_BLUEPRINT_AUTHORING_GUIDANCE } from '@/lib/course-blueprint-authoring-guidance'

const base: CourseBlueprintSnapshot = {
  schema_version: COURSE_BLUEPRINT_SNAPSHOT_SCHEMA_VERSION,
  blueprint_id: '10000000-0000-4000-8000-000000000000',
  draft_revision: 7,
  metadata: {
    title: 'Course',
    subject: 'CS',
    grade_level: '11',
    course_code: 'ICS3U',
    term_template: 'Semester',
  },
  sections: {
    overview_markdown: 'Overview',
    outline_markdown: 'Outline',
    resources_markdown: 'Resources',
  },
  grading: {
    use_weights: false,
    assignments_weight: 70,
    tests_weight: 30,
  },
  planned_site: {
    slug: null,
    published: false,
    config: {
      overview: true,
      outline: true,
      resources: true,
      assignments: true,
      tests: true,
      lesson_plans: true,
    },
  },
  authoring_guidance: EMPTY_COURSE_BLUEPRINT_AUTHORING_GUIDANCE,
  assignments: [{
    artifact_id: '30000000-0000-4000-8000-000000000000',
    title: 'Assignment',
    instructions_markdown: 'Do it.',
    submission_requirements: [],
    default_due_days: 4,
    default_due_time: '23:59',
    points_possible: 10,
    gradebook_weight: 10,
    include_in_final: true,
    is_draft: true,
    position: 0,
  }],
  assessments: [],
  lesson_templates: [],
  materials: [],
  surveys: [],
}

describe('course blueprint change proposals', () => {
  it('uses artifact identity for rename diffs instead of title matching', () => {
    const candidate = structuredClone(base)
    candidate.assignments[0].title = 'Renamed assignment'

    const proposal = buildCourseBlueprintChangeProposal(base, candidate, 'repository')

    expect(proposal.operations).toEqual([
      expect.objectContaining({
        action: 'update',
        collection: 'assignments',
        artifact_id: '30000000-0000-4000-8000-000000000000',
      }),
    ])
    expect(proposal.summary).toEqual({
      add: 0,
      update: 1,
      move: 0,
      archive: 0,
      singleton: 0,
    })
  })

  it('fails stale proposals before mutating any content', () => {
    const candidate = structuredClone(base)
    candidate.assignments[0].title = 'Renamed assignment'
    const proposal = buildCourseBlueprintChangeProposal(base, candidate, 'package')
    const current = structuredClone(base)
    current.draft_revision = 8
    current.sections.overview_markdown = 'A newer classroom edit'
    const before = structuredClone(current)

    expect(() => applyCourseBlueprintChangeProposal(current, proposal)).toThrow(
      StaleCourseBlueprintProposalError
    )
    expect(current).toEqual(before)
  })

  it('applies a validated proposal to a copy and advances the revision once', () => {
    const candidate = structuredClone(base)
    candidate.assignments[0].title = 'Renamed assignment'
    candidate.lesson_templates.push({
      artifact_id: '40000000-0000-4000-8000-000000000000',
      title: 'Launch',
      content_markdown: 'Welcome',
      position: 0,
    })
    const proposal = buildCourseBlueprintChangeProposal(base, candidate, 'ai')

    const applied = applyCourseBlueprintChangeProposal(base, proposal)

    expect(applied.draft_revision).toBe(8)
    expect(applied.assignments[0]?.title).toBe('Renamed assignment')
    expect(applied.lesson_templates).toHaveLength(1)
    expect(base.assignments[0]?.title).toBe('Assignment')
    expect(base.lesson_templates).toEqual([])
  })

  it('reviews guidance changes as a single versioned proposal operation', () => {
    const candidate = structuredClone(base)
    candidate.authoring_guidance.test_guidance_markdown = 'Use concise prompts.'

    const proposal = buildCourseBlueprintChangeProposal(base, candidate, 'repository')
    expect(proposal.operations).toEqual([
      expect.objectContaining({ action: 'singleton', key: 'authoring_guidance' }),
    ])

    const applied = applyCourseBlueprintChangeProposal(base, proposal)
    expect(applied.authoring_guidance.test_guidance_markdown).toBe('Use concise prompts.')
    expect(base.authoring_guidance.test_guidance_markdown).toBe('')
  })
})
