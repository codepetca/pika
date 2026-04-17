import { describe, expect, it } from 'vitest'
import {
  analyzeCourseBlueprintCompleteness,
  buildCourseBlueprintExportBundle,
  decodeCourseBlueprintPackageArchive,
  encodeCourseBlueprintPackageArchive,
  parseCourseBlueprintImportArchive,
  parseCourseBlueprintImportBundle,
} from '@/lib/course-blueprint-package'
import type { CourseBlueprintDetail } from '@/types'

const DETAIL: CourseBlueprintDetail = {
  id: 'blueprint-1',
  teacher_id: 'teacher-1',
  title: 'Computer Science 11',
  subject: 'Computer Science',
  grade_level: 'Grade 11',
  course_code: 'ICS3U',
  term_template: 'Semester 1',
  overview_markdown: '# Overview\nCourse summary',
  outline_markdown: '# Outline\n- Unit 1',
  resources_markdown: '# Resources\n- IDE',
  position: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  assignments: [
    {
      id: 'assignment-1',
      course_blueprint_id: 'blueprint-1',
      title: 'Kickoff reflection',
      instructions_markdown: 'Write a short reflection.',
      default_due_days: 5,
      default_due_time: '23:59',
      points_possible: 10,
      include_in_final: true,
      is_draft: true,
      position: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
  assessments: [
    {
      id: 'assessment-1',
      course_blueprint_id: 'blueprint-1',
      assessment_type: 'quiz',
      title: 'Check-in quiz',
      content: {
        title: 'Check-in quiz',
        show_results: false,
        questions: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            question_text: 'What is the first step?',
            options: ['Plan', 'Practice'],
          },
        ],
      },
      documents: [],
      position: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'assessment-2',
      course_blueprint_id: 'blueprint-1',
      assessment_type: 'test',
      title: 'Unit 1 test',
      content: {
        title: 'Unit 1 test',
        show_results: false,
        questions: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            question_type: 'open_response',
            question_text: 'Explain the main concept.',
            options: [],
            correct_option: null,
            answer_key: 'Main concept explanation',
            sample_solution: null,
            points: 5,
            response_max_chars: 5000,
            response_monospace: false,
          },
        ],
        source_format: 'markdown',
      },
      documents: [],
      position: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
  lesson_templates: [
    {
      id: 'lesson-1',
      course_blueprint_id: 'blueprint-1',
      title: 'Course launch',
      content_markdown: 'Review expectations.',
      position: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
}

describe('course blueprint package', () => {
  it('exports and re-imports the portable package bundle', () => {
    const bundle = buildCourseBlueprintExportBundle(DETAIL)
    const parsed = parseCourseBlueprintImportBundle(bundle)

    expect(parsed.errors).toEqual([])
    expect(parsed.blueprint.title).toBe('Computer Science 11')
    expect(parsed.assignments).toHaveLength(1)
    expect(parsed.assessments).toHaveLength(2)
    expect(parsed.lesson_templates).toHaveLength(1)
  })

  it('exports and re-imports the tar package archive', () => {
    const bundle = buildCourseBlueprintExportBundle(DETAIL)
    const archive = encodeCourseBlueprintPackageArchive(bundle)
    const decoded = decodeCourseBlueprintPackageArchive(archive)
    const parsed = parseCourseBlueprintImportArchive(archive)

    expect(decoded).not.toBeNull()
    expect(decoded?.manifest.title).toBe('Computer Science 11')
    expect(parsed.errors).toEqual([])
    expect(parsed.blueprint.title).toBe('Computer Science 11')
    expect(parsed.assignments).toHaveLength(1)
    expect(parsed.assessments).toHaveLength(2)
    expect(parsed.lesson_templates).toHaveLength(1)
  })

  it('analyzes missing blueprint areas', () => {
    const analysis = analyzeCourseBlueprintCompleteness({
      ...DETAIL,
      overview_markdown: '',
      assignments: [],
      lesson_templates: [],
    })

    expect(analysis.missing).toContain('course overview')
    expect(analysis.missing).toContain('assignments')
    expect(analysis.missing).toContain('lesson templates')
    expect(analysis.suggestions.length).toBeGreaterThan(0)
  })
})
