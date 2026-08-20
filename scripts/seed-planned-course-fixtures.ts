import type { SupabaseClient } from '@supabase/supabase-js'

export const PLANNED_COURSE_FIXTURE = {
  blueprintId: '90000000-0000-4000-8000-000000000201',
  assignmentId: '90000000-0000-4000-8000-000000000202',
  assessmentId: '90000000-0000-4000-8000-000000000203',
  lessonTemplateId: '90000000-0000-4000-8000-000000000204',
  privateBlueprintId: '90000000-0000-4000-8000-000000000205',
  questionId: '90000000-0000-4000-8000-000000000206',
  documentId: '90000000-0000-4000-8000-000000000207',
  publicSlug: 'e2e-planned-computer-science-11',
  privateSlug: 'e2e-private-course-plan',
  privateQuestion: 'Private prompt must not render',
  privateAnswer: 'PRIVATE ANSWER KEY MUST NOT RENDER',
  privateDocumentTitle: 'Private teacher document',
  privateDocumentUrl: 'https://private.example.test/teacher-only',
} as const

function assertSeedResult(
  result: { error: unknown },
  label: string,
) {
  if (result.error) {
    const message = result.error instanceof Error
      ? result.error.message
      : JSON.stringify(result.error)
    throw new Error(`${label} failed: ${message}`)
  }
}

export async function seedPlannedCourseFixtures(
  supabase: SupabaseClient,
  teacherId: string,
) {
  const fixture = PLANNED_COURSE_FIXTURE

  assertSeedResult(
    await supabase.from('course_blueprints').upsert({
      id: fixture.blueprintId,
      teacher_id: teacherId,
      title: 'Computer Science 11',
      subject: 'Computer Science',
      grade_level: 'Grade 11',
      course_code: 'ICS3U',
      term_template: 'Semester 1',
      overview_markdown: [
        'Build a strong foundation in programming, algorithms, and collaborative problem solving.',
        '',
        '[Ontario curriculum](https://www.dcp.edu.gov.on.ca/en/curriculum/secondary-computer-science)',
      ].join('\n'),
      outline_markdown: [
        '## Unit 1: Programming foundations',
        '',
        '- Variables and control flow',
        '- Functions and testing',
        '',
        '## Unit 2: Data structures',
        '',
        '- Lists and maps',
      ].join('\n'),
      resources_markdown: [
        '- [Python documentation](https://docs.python.org/3/)',
        '- Course coding standards',
      ].join('\n'),
      planned_site_slug: fixture.publicSlug,
      planned_site_published: true,
      planned_site_config: {
        overview: true,
        outline: true,
        resources: true,
        assignments: true,
        tests: true,
        lesson_plans: true,
      },
      position: 80,
    }, { onConflict: 'id' }),
    'Seed published planned course Blueprint',
  )

  assertSeedResult(
    await supabase.from('course_blueprint_assignments').upsert({
      id: fixture.assignmentId,
      course_blueprint_id: fixture.blueprintId,
      title: 'Algorithm Design Brief',
      instructions_markdown: 'Compare two approaches and explain the tradeoffs using pseudocode.',
      default_due_days: 7,
      default_due_time: '23:59',
      points_possible: 20,
      include_in_final: true,
      is_draft: true,
      position: 0,
    }, { onConflict: 'id' }),
    'Seed planned course assignment',
  )

  assertSeedResult(
    await supabase.from('course_blueprint_assessments').upsert({
      id: fixture.assessmentId,
      course_blueprint_id: fixture.blueprintId,
      assessment_type: 'test',
      title: 'Programming Foundations Test',
      content: {
        title: 'Programming Foundations Test',
        show_results: false,
        questions: [{
          id: fixture.questionId,
          question_type: 'open_response',
          question_text: fixture.privateQuestion,
          answer_key: fixture.privateAnswer,
          points: 10,
        }],
      },
      documents: [{
        id: fixture.documentId,
        source: 'link',
        title: fixture.privateDocumentTitle,
        url: fixture.privateDocumentUrl,
      }],
      position: 0,
    }, { onConflict: 'id' }),
    'Seed planned course Test',
  )

  assertSeedResult(
    await supabase.from('course_blueprint_lesson_templates').upsert({
      id: fixture.lessonTemplateId,
      course_blueprint_id: fixture.blueprintId,
      title: 'Tracing and Debugging',
      content_markdown: 'Model a trace table, diagnose one defect, and record the correction.',
      position: 0,
    }, { onConflict: 'id' }),
    'Seed planned course lesson template',
  )

  assertSeedResult(
    await supabase.from('course_blueprints').upsert({
      id: fixture.privateBlueprintId,
      teacher_id: teacherId,
      title: 'Private Course Plan',
      planned_site_slug: fixture.privateSlug,
      planned_site_published: false,
      position: 81,
    }, { onConflict: 'id' }),
    'Seed unpublished planned course Blueprint',
  )
}
