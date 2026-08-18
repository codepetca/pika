import { describe, expect, it } from 'vitest'
import {
  getCourseBlueprintDirtySections,
  type CourseBlueprintEditorState,
} from '@/lib/course-blueprint-editor-state'

function editorState(): CourseBlueprintEditorState {
  return {
    metadata: {
      title: 'Computer Science 11',
      subject: 'Computer Science',
      grade_level: 'Grade 11',
      course_code: 'ICS3U',
      term_template: 'Semester 1',
    },
    plannedSite: {
      slug: 'computer-science-11',
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
    grading: {
      use_weights: true,
      assignments_weight: 65,
      tests_weight: 35,
    },
    drafts: {
      overview: 'Overview',
      outline: 'Outline',
      resources: 'Resources',
      assignments: 'Assignments',
      tests: 'Tests',
      'lesson-plans': 'Lesson plans',
      materials: 'Materials',
      surveys: 'Surveys',
    },
  }
}

describe('course blueprint editor dirty state', () => {
  it('reports no dirty sections when the editor matches its saved baseline', () => {
    const saved = editorState()

    expect(getCourseBlueprintDirtySections(editorState(), saved)).toEqual([])
  })

  it('reports each independently edited section', () => {
    const saved = editorState()
    const current = editorState()
    current.metadata.title = 'Computer Science 12'
    current.plannedSite.config.tests = false
    current.grading.tests_weight = 40
    current.drafts.outline = 'Revised outline'
    current.drafts.assignments = 'Revised assignments'

    expect(getCourseBlueprintDirtySections(current, saved)).toEqual([
      'metadata',
      'planned-site',
      'grading',
      'outline',
      'assignments',
    ])
  })

  it('treats reverted edits as clean', () => {
    const saved = editorState()
    const current = editorState()
    current.drafts.resources = 'Temporary edit'
    current.drafts.resources = saved.drafts.resources

    expect(getCourseBlueprintDirtySections(current, saved)).toEqual([])
  })
})
