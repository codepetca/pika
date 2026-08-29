import type { SupabaseClient } from '@supabase/supabase-js'

export const PLANNED_COURSE_FIXTURE = {
  blueprintId: '90000000-0000-4000-8000-000000000201',
  assignmentId: '90000000-0000-4000-8000-000000000202',
  assessmentId: '90000000-0000-4000-8000-000000000203',
  lessonTemplateId: '90000000-0000-4000-8000-000000000204',
  privateBlueprintId: '90000000-0000-4000-8000-000000000205',
  publicationBlueprintId: '90000000-0000-4000-8000-000000000211',
  questionId: '90000000-0000-4000-8000-000000000206',
  documentId: '90000000-0000-4000-8000-000000000207',
  assignmentArtifactId: '90000000-0000-4000-8000-000000000208',
  assessmentArtifactId: '90000000-0000-4000-8000-000000000209',
  lessonTemplateArtifactId: '90000000-0000-4000-8000-000000000210',
  publicSlug: 'e2e-planned-computer-science-11',
  privateSlug: 'e2e-private-course-plan',
  publicationSlug: 'e2e-publication-lifecycle',
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

function matchesExactly(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && actual.length === expected.length
      && expected.every((value, index) => matchesExactly(actual[index], value))
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false
    const actualEntries = Object.entries(actual)
    const expectedEntries = Object.entries(expected)
    return actualEntries.length === expectedEntries.length
      && expectedEntries.every(([key, value]) => (
        Object.hasOwn(actual, key)
        && matchesExactly((actual as Record<string, unknown>)[key], value)
      ))
  }
  return actual === expected
}

async function loadFixtureRows(
  supabase: SupabaseClient,
  table: string,
  column: string,
  values: readonly string[],
) {
  const result = await supabase.from(table).select('*').in(column, [...values])
  assertSeedResult(result, `Load ${table}`)
  return (result.data ?? []) as Array<Record<string, unknown>>
}

function hasExactRows(
  actual: Array<Record<string, unknown>>,
  expected: Array<Record<string, unknown>>,
) {
  return actual.length === expected.length
    && expected.every((expectedRow) => actual.some((row) => {
      if (row.id !== expectedRow.id) return false
      const projectedRow = Object.fromEntries(
        Object.keys(expectedRow).map((key) => [key, row[key]]),
      )
      return matchesExactly(projectedRow, expectedRow)
    }))
}

export async function seedPlannedCourseFixtures(
  supabase: SupabaseClient,
  teacherId: string,
) {
  const fixture = PLANNED_COURSE_FIXTURE
  const plannedSiteConfig = {
    overview: true,
    outline: true,
    resources: true,
    assignments: true,
    tests: true,
    lesson_plans: true,
  }
  const publicBlueprint = {
    id: fixture.blueprintId,
    teacher_id: teacherId,
    authority_mode: 'pika',
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
    gradebook_use_weights: false,
    gradebook_assignments_weight: 70,
    gradebook_tests_weight: 30,
    planned_site_config: plannedSiteConfig,
    position: 80,
  }
  const privateBlueprint = {
    id: fixture.privateBlueprintId,
    teacher_id: teacherId,
    authority_mode: 'pika',
    title: 'Private Course Plan',
    subject: '',
    grade_level: '',
    course_code: '',
    term_template: '',
    overview_markdown: '',
    outline_markdown: '',
    resources_markdown: '',
    gradebook_use_weights: false,
    gradebook_assignments_weight: 70,
    gradebook_tests_weight: 30,
    planned_site_slug: fixture.privateSlug,
    planned_site_published: false,
    planned_site_config: plannedSiteConfig,
    position: 81,
  }
  const publicationBlueprint = {
    id: fixture.publicationBlueprintId,
    teacher_id: teacherId,
    authority_mode: 'pika',
    title: 'Publication Lifecycle Fixture',
    subject: 'Computer Science',
    grade_level: 'Grade 11',
    course_code: 'E2E',
    term_template: 'Semester 1',
    overview_markdown: 'Dedicated mutable fixture for the publication lifecycle browser contract.',
    outline_markdown: '',
    resources_markdown: '',
    gradebook_use_weights: false,
    gradebook_assignments_weight: 70,
    gradebook_tests_weight: 30,
    planned_site_slug: fixture.publicationSlug,
    planned_site_published: true,
    planned_site_config: plannedSiteConfig,
    position: 82,
  }
  const assignment = {
    id: fixture.assignmentId,
    artifact_id: fixture.assignmentArtifactId,
    course_blueprint_id: fixture.blueprintId,
    title: 'Algorithm Design Brief',
    instructions_markdown: 'Compare two approaches and explain the tradeoffs using pseudocode.',
    submission_requirements_json: [],
    default_due_days: 7,
    default_due_time: '23:59',
    points_possible: 20,
    gradebook_weight: 10,
    include_in_final: true,
    is_draft: true,
    track_authenticity: false,
    position: 0,
  }
  const assessment = {
    id: fixture.assessmentId,
    artifact_id: fixture.assessmentArtifactId,
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
    points_possible: 10,
    gradebook_weight: 10,
    include_in_final: true,
    position: 0,
  }
  const lessonTemplate = {
    id: fixture.lessonTemplateId,
    artifact_id: fixture.lessonTemplateArtifactId,
    course_blueprint_id: fixture.blueprintId,
    title: 'Tracing and Debugging',
    content_markdown: 'Model a trace table, diagnose one defect, and record the correction.',
    position: 0,
  }
  const childFixtures = [
    { table: 'course_blueprint_assignments', rows: [assignment] },
    { table: 'course_blueprint_assessments', rows: [assessment] },
    { table: 'course_blueprint_lesson_templates', rows: [lessonTemplate] },
    { table: 'course_blueprint_materials', rows: [] },
    { table: 'course_blueprint_surveys', rows: [] },
  ] as const

  const blueprintIds = [
    fixture.blueprintId,
    fixture.privateBlueprintId,
    fixture.publicationBlueprintId,
  ]
  const existingBlueprints = await loadFixtureRows(
    supabase,
    'course_blueprints',
    'id',
    blueprintIds,
  )
  let fixtureIsExact = hasExactRows(existingBlueprints, [
    publicBlueprint,
    privateBlueprint,
    publicationBlueprint,
  ])
  for (const child of childFixtures) {
    const existingRows = await loadFixtureRows(
      supabase,
      child.table,
      'course_blueprint_id',
      blueprintIds,
    )
    fixtureIsExact = fixtureIsExact && hasExactRows(
      existingRows,
      child.rows as unknown as Array<Record<string, unknown>>,
    )
  }

  if (fixtureIsExact) return { changed: false }

  assertSeedResult(
    await supabase.from('course_blueprints').upsert({
      ...publicBlueprint,
      planned_site_published: false,
    }, { onConflict: 'id' }),
    'Stage unpublished planned course Blueprint',
  )

  assertSeedResult(
    await supabase.from('course_blueprints').upsert(privateBlueprint, { onConflict: 'id' }),
    'Seed unpublished planned course Blueprint',
  )

  assertSeedResult(
    await supabase.from('course_blueprints').upsert(publicationBlueprint, { onConflict: 'id' }),
    'Seed publication lifecycle Blueprint',
  )

  for (const child of childFixtures) {
    assertSeedResult(
      await supabase.from(child.table).delete().eq(
        'course_blueprint_id',
        fixture.privateBlueprintId,
      ),
      `Reset private ${child.table}`,
    )
    assertSeedResult(
      await supabase.from(child.table).delete().eq(
        'course_blueprint_id',
        fixture.publicationBlueprintId,
      ),
      `Reset publication lifecycle ${child.table}`,
    )

    const canonicalRow = child.rows[0]
    const deleteDrift = supabase.from(child.table).delete()
      .eq('course_blueprint_id', fixture.blueprintId)
    assertSeedResult(
      await (canonicalRow ? deleteDrift.neq('id', canonicalRow.id) : deleteDrift),
      `Remove drift from ${child.table}`,
    )

    if (canonicalRow) {
      assertSeedResult(
        await supabase.from(child.table).upsert(canonicalRow, { onConflict: 'id' }),
        `Seed canonical ${child.table}`,
      )
    }
  }

  assertSeedResult(
    await supabase.from('course_blueprints')
      .update({ planned_site_published: true })
      .eq('id', fixture.blueprintId),
    'Publish planned course Blueprint',
  )

  return { changed: true }
}
