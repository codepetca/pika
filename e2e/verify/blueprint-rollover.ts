/**
 * Verification: Classroom -> Blueprint -> Classroom rollover
 *
 * Runs against the seeded local Test Classroom and proves that reusable course
 * structure survives while student/runtime records do not cross the boundary.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config as loadEnvironment } from 'dotenv'
import { expect } from '@playwright/test'
import { z } from 'zod'

import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { getLessonPlanMarkdown } from '@/lib/lesson-plan-content'
import type { VerificationCheck, VerificationResult, VerificationScript } from './types'
import { TIMEOUTS } from './types'

const uuidSchema = z.string().uuid()
const captureResponseSchema = z.object({ blueprint_id: uuidSchema })
const instantiateResponseSchema = z.object({
  classroom: z.object({ id: uuidSchema, title: z.string() }),
})

const reusableTables = [
  'assignments',
  'tests',
  'lesson_plans',
  'classwork_materials',
  'surveys',
  'announcements',
] as const

const liveTables = [
  'classroom_enrollments',
  'classroom_roster',
  'entries',
] as const

type ServiceClient = SupabaseClient<any, 'public', 'public', any, any>
type ReusableTable = typeof reusableTables[number]
type LiveTable = typeof liveTables[number]

type ClassroomSnapshot = {
  reusable: Record<ReusableTable, Array<Record<string, unknown>>>
  nested: {
    assignment_submission_requirements: Array<Record<string, unknown>>
    test_questions: Array<Record<string, unknown>>
    survey_questions: Array<Record<string, unknown>>
  }
  settings: {
    classroom: Record<string, unknown>
    resources: Record<string, unknown> | null
    grading: Record<string, unknown> | null
  }
  liveCounts: Record<LiveTable | 'assignment_docs' | 'test_attempts', number>
}

export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

function requireLoopback(label: string, value: string) {
  if (!isLoopbackUrl(value)) {
    throw new Error(`${label} must use a loopback URL for the rollover drill`)
  }
}

function addRequiredCheck(
  checks: VerificationCheck[],
  name: string,
  passed: boolean,
  message: string,
) {
  checks.push({ name, passed, message: passed ? undefined : message })
  if (!passed) throw new Error(message)
}

function normalizeTitles(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => String(row.title || '')).sort()
}

function normalizeNestedRows(
  rows: Array<Record<string, unknown>>,
  parentKey: string,
) {
  const ignored = new Set([
    'id',
    parentKey,
    'artifact_id',
    'source_artifact_id',
    'source_blueprint_version_id',
    'created_at',
    'updated_at',
  ])
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).filter(([key]) => !ignored.has(key)),
  )).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
}

function normalizeAnnouncements(rows: Array<Record<string, unknown>>) {
  const ignored = new Set(['id', 'classroom_id', 'created_at', 'updated_at'])
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).filter(([key]) => !ignored.has(key)),
  )).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
}

function sourceIdentity(row: Record<string, unknown>): string {
  return String(row.source_artifact_id || row.artifact_id || row.id || '')
}

function targetSourceIdentities(rows: Array<Record<string, unknown>>): string[] {
  return rows.map((row) => String(row.source_artifact_id || '')).sort()
}

async function countRows(
  supabase: ServiceClient,
  table: string,
  column: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0
  const response = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .in(column, ids)
  if (response.error) throw new Error(`Could not count ${table}: ${response.error.code}`)
  return response.count || 0
}

async function loadClassroomSnapshot(
  supabase: ServiceClient,
  classroomId: string,
): Promise<ClassroomSnapshot> {
  const [classroomResponse, resourcesResponse, gradingResponse] = await Promise.all([
    supabase
      .from('classrooms')
      .select('course_overview_markdown, course_outline_markdown')
      .eq('id', classroomId)
      .single(),
    supabase.from('classroom_resources').select('content').eq('classroom_id', classroomId).maybeSingle(),
    supabase
      .from('gradebook_settings')
      .select('use_weights, assignments_weight, tests_weight')
      .eq('classroom_id', classroomId)
      .maybeSingle(),
  ])
  if (classroomResponse.error || !classroomResponse.data) {
    throw new Error(`Could not load classroom settings: ${classroomResponse.error?.code || 'missing'}`)
  }
  if (resourcesResponse.error || gradingResponse.error) {
    throw new Error(`Could not load reusable settings: ${resourcesResponse.error?.code || gradingResponse.error?.code}`)
  }

  const reusableEntries = await Promise.all(reusableTables.map(async (table) => {
    let query = supabase.from(table).select('*').eq('classroom_id', classroomId)
    if (table !== 'announcements') query = query.is('blueprint_archived_at', null)
    const response = await query
    if (response.error) throw new Error(`Could not load ${table}: ${response.error.code}`)
    return [table, (response.data || []) as Array<Record<string, unknown>>] as const
  }))
  const reusable = Object.fromEntries(reusableEntries) as ClassroomSnapshot['reusable']

  const liveEntries = await Promise.all(liveTables.map(async (table) => {
    const response = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('classroom_id', classroomId)
    if (response.error) throw new Error(`Could not count ${table}: ${response.error.code}`)
    return [table, response.count || 0] as const
  }))
  const assignmentIds = reusable.assignments.map((row) => String(row.id))
  const testIds = reusable.tests.map((row) => String(row.id))
  const surveyIds = reusable.surveys.map((row) => String(row.id))

  const loadNested = async (table: string, column: string, ids: string[]) => {
    if (ids.length === 0) return []
    const response = await supabase.from(table).select('*').in(column, ids)
    if (response.error) throw new Error(`Could not load ${table}: ${response.error.code}`)
    return (response.data || []) as Array<Record<string, unknown>>
  }

  return {
    reusable,
    nested: {
      assignment_submission_requirements: await loadNested(
        'assignment_submission_requirements',
        'assignment_id',
        assignmentIds,
      ),
      test_questions: await loadNested('test_questions', 'test_id', testIds),
      survey_questions: await loadNested('survey_questions', 'survey_id', surveyIds),
    },
    settings: {
      classroom: {
        course_overview_markdown: classroomResponse.data.course_overview_markdown || '',
        course_outline_markdown: classroomResponse.data.course_outline_markdown || '',
      },
      resources: (resourcesResponse.data as Record<string, unknown> | null) || {
        content: { type: 'doc', content: [] },
      },
      grading: (gradingResponse.data as Record<string, unknown> | null) || {
        use_weights: false,
        assignments_weight: 70,
        tests_weight: 30,
      },
    },
    liveCounts: {
      ...Object.fromEntries(liveEntries) as Record<LiveTable, number>,
      assignment_docs: await countRows(supabase, 'assignment_docs', 'assignment_id', assignmentIds),
      test_attempts: await countRows(supabase, 'test_attempts', 'test_id', testIds),
    },
  }
}

function resolveLocalDatabaseUrl(): string {
  const rawStatus = execFileSync(
    'pnpm',
    ['exec', 'supabase', 'status', '-o', 'json'],
    { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const status = z.object({ DB_URL: z.string().url() }).parse(JSON.parse(rawStatus))
  requireLoopback('Local Supabase database', status.DB_URL)
  return status.DB_URL
}

function cleanupLocalDrill(
  databaseUrl: string,
  classroomId: string | null,
  blueprintId: string | null,
) {
  if (!classroomId && !blueprintId) return
  requireLoopback('Local Supabase database', databaseUrl)
  const verifiedClassroomId = classroomId ? uuidSchema.parse(classroomId) : null
  const verifiedBlueprintId = blueprintId ? uuidSchema.parse(blueprintId) : null
  const statements = [
    'begin',
    "set local pika.course_blueprint_purge_finalize = 'on'",
    verifiedClassroomId ? `delete from public.classrooms where id = '${verifiedClassroomId}'` : null,
    verifiedBlueprintId ? `delete from public.course_blueprints where id = '${verifiedBlueprintId}'` : null,
    'commit',
  ].filter(Boolean).join('; ') + ';'

  execFileSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-c', statements], {
    cwd: process.cwd(),
    stdio: 'ignore',
  })
}

function compareReusableStructure(
  checks: VerificationCheck[],
  source: ClassroomSnapshot,
  target: ClassroomSnapshot,
) {
  for (const table of reusableTables) {
    const sourceTitles = normalizeTitles(source.reusable[table])
    const targetTitles = normalizeTitles(target.reusable[table])
    addRequiredCheck(
      checks,
      `${table} preserved`,
      JSON.stringify(targetTitles) === JSON.stringify(sourceTitles),
      `${table} differed: source=${JSON.stringify(sourceTitles)} target=${JSON.stringify(targetTitles)}`,
    )

    if (table !== 'announcements') {
      const sourceIdentities = source.reusable[table].map(sourceIdentity).sort()
      addRequiredCheck(
        checks,
        `${table} lineage preserved`,
        JSON.stringify(targetSourceIdentities(target.reusable[table])) === JSON.stringify(sourceIdentities),
        `${table} did not preserve source artifact identity`,
      )
    }
  }

  const nestedContracts = [
    ['assignment_submission_requirements', 'assignment_id'],
    ['test_questions', 'test_id'],
    ['survey_questions', 'survey_id'],
  ] as const
  for (const [table, parentKey] of nestedContracts) {
    addRequiredCheck(
      checks,
      `${table} content preserved`,
      JSON.stringify(normalizeNestedRows(target.nested[table], parentKey))
        === JSON.stringify(normalizeNestedRows(source.nested[table], parentKey)),
      `${table} content differed after rollover`,
    )
  }
  addRequiredCheck(
    checks,
    'Announcement content preserved',
    JSON.stringify(normalizeAnnouncements(target.reusable.announcements))
      === JSON.stringify(normalizeAnnouncements(source.reusable.announcements)),
    'Announcement content differed after rollover',
  )

  addRequiredCheck(
    checks,
    'Course overview and outline preserved',
    JSON.stringify(target.settings.classroom) === JSON.stringify(source.settings.classroom),
    'Course overview or outline differed after rollover',
  )
  addRequiredCheck(
    checks,
    'Course resources preserved',
    JSON.stringify(target.settings.resources) === JSON.stringify(source.settings.resources),
    'Course resources differed after rollover',
  )
  addRequiredCheck(
    checks,
    'Gradebook configuration preserved',
    JSON.stringify(target.settings.grading) === JSON.stringify(source.settings.grading),
    'Gradebook configuration differed after rollover',
  )

  const sourceAssignmentsByIdentity = new Map(
    source.reusable.assignments.map((row) => [sourceIdentity(row), row]),
  )
  addRequiredCheck(
    checks,
    'Assignment instructions preserved',
    target.reusable.assignments.every((row) => {
      const sourceRow = sourceAssignmentsByIdentity.get(String(row.source_artifact_id || ''))
      if (!sourceRow) return false
      return String(row.instructions_markdown || '') === getAssignmentInstructionsMarkdown(sourceRow as any).markdown
    }),
    'At least one assignment lost or changed its instructions',
  )

  const sourceLessonsByIdentity = new Map(
    source.reusable.lesson_plans.map((row) => [sourceIdentity(row), row]),
  )
  addRequiredCheck(
    checks,
    'Lesson content preserved',
    target.reusable.lesson_plans.every((row) => {
      const sourceRow = sourceLessonsByIdentity.get(String(row.source_artifact_id || ''))
      if (!sourceRow) return false
      return getLessonPlanMarkdown(row as any).markdown === getLessonPlanMarkdown(sourceRow as any).markdown
    }),
    'At least one lesson lost or changed its content',
  )

  addRequiredCheck(
    checks,
    'Assignments require teacher release',
    target.reusable.assignments.every((row) => row.is_draft === true && row.released_at === null),
    'At least one rollover assignment was released or not a draft',
  )
  addRequiredCheck(
    checks,
    'Tests require teacher release',
    target.reusable.tests.every((row) => row.status === 'draft'),
    'At least one rollover test was not a draft',
  )

  for (const [table, count] of Object.entries(target.liveCounts)) {
    addRequiredCheck(
      checks,
      `${table} excluded`,
      count === 0,
      `Expected no ${table} in the rollover classroom, found ${count}`,
    )
  }
}

export const blueprintRollover: VerificationScript = {
  name: 'blueprint-rollover',
  description: 'Verify a seeded classroom round-trips through a Blueprint without live student data',
  role: 'teacher',

  async run(page, baseUrl): Promise<VerificationResult> {
    const checks: VerificationCheck[] = []
    const artifacts: string[] = []
    let error: string | undefined
    let blueprintId: string | null = null
    let classroomId: string | null = null
    let databaseUrl = ''
    let supabase: ServiceClient | null = null
    let token = ''
    let classroomTitle = ''

    try {
      requireLoopback('E2E base URL', baseUrl)
      loadEnvironment({ path: path.resolve(process.cwd(), process.env.ENV_FILE || '.env.local') })
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
      const secretKey = process.env.SUPABASE_SECRET_KEY || ''
      requireLoopback('Supabase API', supabaseUrl)
      if (!secretKey) throw new Error('SUPABASE_SECRET_KEY is required for the rollover drill')
      databaseUrl = resolveLocalDatabaseUrl()

      supabase = createClient(supabaseUrl, secretKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      const sourceResponse = await supabase
        .from('classrooms')
        .select('id, title')
        .eq('class_code', process.env.E2E_ROLLOVER_SOURCE_CLASS_CODE || 'TEST01')
        .is('archived_at', null)
        .single()
      if (sourceResponse.error || !sourceResponse.data) {
        throw new Error('Seeded Test Classroom is unavailable; run "pnpm seed" first')
      }
      const sourceClassroomId = uuidSchema.parse(sourceResponse.data.id)
      const source = await loadClassroomSnapshot(supabase, sourceClassroomId)
      addRequiredCheck(
        checks,
        'Source fixture contains reusable structure',
        source.reusable.assignments.length > 0
          && source.reusable.tests.length > 0
          && source.reusable.lesson_plans.length > 0,
        'The seeded classroom needs assignments, tests, and lesson plans',
      )
      addRequiredCheck(
        checks,
        'Source fixture contains live student data',
        source.liveCounts.classroom_enrollments > 0
          && source.liveCounts.entries > 0
          && source.liveCounts.assignment_docs > 0
          && source.liveCounts.test_attempts > 0,
        'The seeded classroom needs enrollments, logs, submissions, and test attempts',
      )
      addRequiredCheck(
        checks,
        'Source fixture has no managed test uploads',
        source.reusable.tests.every((row) => (
          !Array.isArray(row.documents)
            || row.documents.every((document) => (
              typeof document !== 'object'
                || document === null
                || !('source' in document)
                || document.source !== 'upload'
            ))
        )),
        'The local cleanup path cannot safely remove copied managed test uploads',
      )

      token = `Rollover Drill ${Date.now()}`
      const artifactDir = path.resolve(process.cwd(), 'artifacts', 'blueprint-rollover', token.replaceAll(' ', '-'))
      fs.mkdirSync(artifactDir, { recursive: true })

      await page.goto(`${baseUrl}/classrooms/${sourceClassroomId}?tab=settings&section=reuse`)
      await page.getByRole('button', { name: 'Save as Course Blueprint' })
        .waitFor({ state: 'visible', timeout: TIMEOUTS.NAVIGATION })
      await page.getByRole('button', { name: 'Save as Course Blueprint' }).click()
      await page.getByLabel('Course Blueprint Title').fill(token)
      const capturePromise = page.waitForResponse((response) => (
        response.request().method() === 'POST'
          && response.url().endsWith(`/api/teacher/classrooms/${sourceClassroomId}/blueprint`)
      ))
      await page.getByRole('button', { name: 'Save Blueprint' }).click()
      const captureResponse = await capturePromise
      if (!captureResponse.ok()) throw new Error(`Blueprint capture failed with ${captureResponse.status()}`)
      blueprintId = captureResponseSchema.parse(await captureResponse.json()).blueprint_id
      await page.waitForURL(/\/teacher\/blueprints\?/, { timeout: TIMEOUTS.NAVIGATION })
      await page.getByText(`${source.reusable.assignments.length} assignments`, { exact: false })
        .waitFor({ state: 'visible', timeout: TIMEOUTS.ELEMENT_VISIBLE })
      const blueprintScreenshot = path.join(artifactDir, '01-blueprint-review.png')
      await page.screenshot({ path: blueprintScreenshot, fullPage: true })
      artifacts.push(blueprintScreenshot)

      await page.getByRole('button', { name: 'Use for Classroom' }).click()
      classroomTitle = `${token} Classroom`
      await page.getByLabel('Classroom Name').fill(classroomTitle)
      await page.getByRole('button', { name: 'Next' }).click()
      await page.getByRole('combobox', { name: 'Course Blueprint' })
        .waitFor({ state: 'visible', timeout: TIMEOUTS.ELEMENT_VISIBLE })
      await page.getByRole('option', { name: token })
        .waitFor({ state: 'attached', timeout: TIMEOUTS.ELEMENT_VISIBLE })
      await expect(page.getByRole('combobox', { name: 'Course Blueprint' }))
        .toHaveValue(blueprintId, { timeout: TIMEOUTS.ELEMENT_VISIBLE })
      addRequiredCheck(
        checks,
        'Captured Blueprint preselected',
        await page.getByRole('combobox', { name: 'Course Blueprint' }).inputValue() === blueprintId,
        'The captured Blueprint was not selected in the classroom wizard',
      )
      await page.getByRole('button', { name: 'Next' }).click()
      const instantiatePromise = page.waitForResponse((response) => (
        response.request().method() === 'POST'
          && response.url().endsWith(`/api/teacher/course-blueprints/${blueprintId}/instantiate`)
      ))
      await page.getByRole('button', { name: 'Create' }).click()
      const instantiateResponse = await instantiatePromise
      if (!instantiateResponse.ok()) {
        throw new Error(`Blueprint instantiation failed with ${instantiateResponse.status()}`)
      }
      const instantiated = instantiateResponseSchema.parse(await instantiateResponse.json())
      classroomId = instantiated.classroom.id
      await page.getByRole('heading', { name: 'Classroom Created' })
        .waitFor({ state: 'visible', timeout: TIMEOUTS.NAVIGATION })
      addRequiredCheck(
        checks,
        'Teacher receives release review handoff',
        await page.getByText(/assignments and tests are unpublished/i).isVisible(),
        'The classroom-created review did not explain the release review requirement',
      )
      const handoffScreenshot = path.join(artifactDir, '02-release-review-handoff.png')
      await page.screenshot({ path: handoffScreenshot, fullPage: true })
      artifacts.push(handoffScreenshot)

      await page.getByRole('button', { name: 'Review Classroom' }).click()
      await page.waitForURL(new RegExp(`/classrooms/${classroomId}\\?tab=assignments`), {
        timeout: TIMEOUTS.NAVIGATION,
      })
      await page.getByText('Draft', { exact: true }).first()
        .waitFor({ state: 'visible', timeout: TIMEOUTS.ELEMENT_VISIBLE })
      const reviewScreenshot = path.join(artifactDir, '03-assignment-review.png')
      await page.screenshot({ path: reviewScreenshot, fullPage: true })
      artifacts.push(reviewScreenshot)

      const target = await loadClassroomSnapshot(supabase, classroomId)
      compareReusableStructure(checks, source, target)
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    } finally {
      try {
        if (supabase && token && !blueprintId) {
          const response = await supabase
            .from('course_blueprints')
            .select('id')
            .eq('title', token)
            .maybeSingle()
          if (response.error) throw new Error(`Could not locate drill Blueprint: ${response.error.code}`)
          blueprintId = response.data?.id ? uuidSchema.parse(response.data.id) : null
        }
        if (supabase && classroomTitle && !classroomId) {
          const response = await supabase
            .from('classrooms')
            .select('id')
            .eq('title', classroomTitle)
            .maybeSingle()
          if (response.error) throw new Error(`Could not locate drill classroom: ${response.error.code}`)
          classroomId = response.data?.id ? uuidSchema.parse(response.data.id) : null
        }
        if (databaseUrl) cleanupLocalDrill(databaseUrl, classroomId, blueprintId)
        checks.push({ name: 'Local drill fixtures cleaned up', passed: true })
      } catch (cleanupError) {
        const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        checks.push({ name: 'Local drill fixtures cleaned up', passed: false, message })
        error = error ? `${error}; cleanup failed: ${message}` : `Cleanup failed: ${message}`
      }
    }

    return {
      scenario: 'blueprint-rollover',
      passed: !error && checks.every((check) => check.passed),
      checks,
      error,
      artifacts,
    }
  },
}
