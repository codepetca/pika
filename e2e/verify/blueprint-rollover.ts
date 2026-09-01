/**
 * Verification: Classroom -> Blueprint -> Classroom rollover
 *
 * Runs against the seeded local Test Classroom and proves that reusable course
 * structure survives while student/runtime records do not cross the boundary.
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { addDays, differenceInCalendarDays, isValid, parseISO } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { config as loadEnvironment } from 'dotenv'
import type { Page } from '@playwright/test'
import { z } from 'zod'

import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { getLessonPlanMarkdown } from '@/lib/lesson-plan-content'
import { stripTestDocumentSnapshots } from '@/lib/test-documents'
import type { VerificationCheck, VerificationResult, VerificationScript } from './types'
import { TIMEOUTS } from './types'

const uuidSchema = z.string().uuid()
const captureResponseSchema = z.object({
  blueprint_id: uuidSchema,
  operation_id: uuidSchema,
})
const instantiateResponseSchema = z.object({
  classroom: z.object({ id: uuidSchema, title: z.string() }),
  operation_id: uuidSchema,
})
const operationResponseSchema = z.object({
  operation_id: uuidSchema.optional(),
  error: z.string().optional(),
}).passthrough()

const reusableTables = [
  'assignments',
  'tests',
  'lesson_plans',
  'classwork_materials',
  'surveys',
] as const

const liveTables = [
  'classroom_enrollments',
  'classroom_roster',
  'entries',
  'announcements',
] as const

type ServiceClient = SupabaseClient<any, 'public', 'public', any, any>
type ReusableTable = typeof reusableTables[number]
type LiveTable = typeof liveTables[number]
type IdentityTable = ReusableTable
  | 'assignment_submission_requirements'
  | 'test_questions'
  | 'survey_questions'

type IdentityRow = {
  id: string
  artifact_id: string
  source_artifact_id: string | null
  source_blueprint_version_id: string | null
}

type SourceMutableState = {
  classroom: {
    source_blueprint_id: string | null
    source_blueprint_origin: unknown
    source_blueprint_version_id: string | null
    blueprint_source_revision: number
  }
  identities: Record<IdentityTable, IdentityRow[]>
  testDocuments: Array<{ id: string; documents: unknown }>
}

type LocalInventory = {
  operationIds: string[]
  storageObjectIds: string[]
}

type SourceFixtureIds = Record<
  'assignment' | 'material' | 'survey' | 'surveyQuestion' | 'requirement' | 'announcement' | 'announcementRead' | 'testDocument',
  string
>

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
    startDate: string | null
    sourceBlueprintVersionId: string | null
    actualSiteSlug: string | null
    actualSitePublished: boolean
  }
  liveCounts: Record<
    LiveTable | 'announcement_reads' | 'assignment_docs' | 'submitted_assignment_docs' | 'test_attempts' | 'test_responses',
    number
  >
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

export function getStudentFacingDefaultChecks(input: {
  assignments: Array<Record<string, unknown>>
  tests: Array<Record<string, unknown>>
  materials: Array<Record<string, unknown>>
  surveys: Array<Record<string, unknown>>
  classroom: { actual_site_slug: string | null; actual_site_published: boolean }
}): VerificationCheck[] {
  return [
    {
      name: 'Assignments remain unavailable to students',
      passed: input.assignments.every((row) => row.is_draft === true && row.released_at === null),
      message: 'At least one rollover assignment was released or not a draft',
    },
    {
      name: 'Tests remain unavailable to students',
      passed: input.tests.every((row) => row.status === 'draft'),
      message: 'At least one rollover Test was not a draft',
    },
    {
      name: 'Materials remain unavailable to students',
      passed: input.materials.every((row) => row.is_draft === true && row.released_at === null),
      message: 'At least one rollover material was released or not a draft',
    },
    {
      name: 'Surveys remain unavailable to students',
      passed: input.surveys.every((row) => row.status === 'draft' && row.opens_at === null),
      message: 'At least one rollover survey was opened or not a draft',
    },
    {
      name: 'Actual classroom site remains unpublished',
      passed: input.classroom.actual_site_published === false && input.classroom.actual_site_slug === null,
      message: 'The rollover classroom created a published or addressable actual course site',
    },
  ]
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

function sourceIdentity(row: Record<string, unknown>): string {
  return String(row.source_artifact_id || row.artifact_id || row.id || '')
}

function targetSourceIdentities(rows: Array<Record<string, unknown>>): string[] {
  return rows.map((row) => String(row.source_artifact_id || '')).sort()
}

function targetArtifactIdentities(rows: Array<Record<string, unknown>>): string[] {
  return rows.map((row) => String(row.artifact_id || '')).sort()
}

function normalizeTestDefinition(row: Record<string, unknown>) {
  return {
    title: String(row.title || ''),
    show_results: row.show_results === true,
    documents: stripTestDocumentSnapshots(row.documents),
    points_possible: row.points_possible === null ? null : Number(row.points_possible),
    gradebook_weight: Number(row.gradebook_weight),
    include_in_final: row.include_in_final !== false,
    position: Number(row.position),
  }
}

function normalizeAssignmentTiming(startDate: string | null, dueAt: unknown) {
  if (typeof dueAt !== 'string') return { dueDays: 0, dueTime: '23:59' }
  const dueDate = parseISO(dueAt)
  if (!isValid(dueDate)) return { dueDays: 0, dueTime: '23:59' }
  const torontoDueDate = toZonedTime(dueDate, 'America/Toronto')
  const dueTime = `${String(torontoDueDate.getHours()).padStart(2, '0')}:${String(torontoDueDate.getMinutes()).padStart(2, '0')}`
  if (!startDate) return { dueDays: 0, dueTime }
  const start = parseISO(startDate)
  return {
    dueDays: isValid(start) ? differenceInCalendarDays(torontoDueDate, start) : 0,
    dueTime,
  }
}

function normalizeAssignmentDefinition(row: Record<string, unknown>, startDate: string | null) {
  return {
    title: String(row.title || ''),
    instructions: getAssignmentInstructionsMarkdown(row as any).markdown,
    timing: normalizeAssignmentTiming(startDate, row.due_at),
    points_possible: row.points_possible === null ? null : Number(row.points_possible),
    gradebook_weight: Number(row.gradebook_weight),
    include_in_final: row.include_in_final !== false,
    track_authenticity: row.track_authenticity === true,
    position: Number(row.position),
  }
}

export function recordKnownOperationId(
  headers: Record<string, string>,
  operationIds: string[],
): string | null {
  const parsed = uuidSchema.safeParse(headers['idempotency-key'])
  if (!parsed.success) return null
  if (!operationIds.includes(parsed.data)) operationIds.push(parsed.data)
  return parsed.data
}

async function installOperationIdentityGuard(
  page: Page,
  mutationUrls: string[],
  operationIds: string[],
) {
  await page.route('**/api/teacher/**', async (route) => {
    const request = route.request()
    const isGuardedMutation = request.method() === 'POST'
      && mutationUrls.some((url) => request.url().endsWith(url))
    if (!isGuardedMutation) {
      await route.continue()
      return
    }
    if (!recordKnownOperationId(request.headers(), operationIds)) {
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
}

export function createSourceFixtureIds(): SourceFixtureIds {
  return {
    assignment: randomUUID(),
    material: randomUUID(),
    survey: randomUUID(),
    surveyQuestion: randomUUID(),
    requirement: randomUUID(),
    announcement: randomUUID(),
    announcementRead: randomUUID(),
    testDocument: randomUUID(),
  }
}

function identityRows(rows: Array<Record<string, unknown>>): IdentityRow[] {
  return rows.map((row) => ({
    id: uuidSchema.parse(row.id),
    artifact_id: uuidSchema.parse(row.artifact_id),
    source_artifact_id: row.source_artifact_id ? uuidSchema.parse(row.source_artifact_id) : null,
    source_blueprint_version_id: row.source_blueprint_version_id
      ? uuidSchema.parse(row.source_blueprint_version_id)
      : null,
  })).sort((left, right) => left.id.localeCompare(right.id))
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
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

async function countSubmittedAssignmentDocs(
  supabase: ServiceClient,
  assignmentIds: string[],
): Promise<number> {
  if (assignmentIds.length === 0) return 0
  const response = await supabase
    .from('assignment_docs')
    .select('*', { count: 'exact', head: true })
    .in('assignment_id', assignmentIds)
    .eq('is_submitted', true)
  if (response.error) {
    throw new Error(`Could not count submitted assignment_docs: ${response.error.code}`)
  }
  return response.count || 0
}

async function loadClassroomSnapshot(
  supabase: ServiceClient,
  classroomId: string,
): Promise<ClassroomSnapshot> {
  const [classroomResponse, resourcesResponse, gradingResponse] = await Promise.all([
    supabase
      .from('classrooms')
      .select('course_overview_markdown, course_outline_markdown, start_date, source_blueprint_version_id, actual_site_slug, actual_site_published')
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
    const response = await supabase
      .from(table)
      .select('*')
      .eq('classroom_id', classroomId)
      .is('blueprint_archived_at', null)
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
  const announcementResponse = await supabase
    .from('announcements')
    .select('id')
    .eq('classroom_id', classroomId)
  if (announcementResponse.error) {
    throw new Error(`Could not load announcements: ${announcementResponse.error.code}`)
  }
  const announcementIds = (announcementResponse.data || []).map((row) => String(row.id))

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
      startDate: classroomResponse.data.start_date || null,
      sourceBlueprintVersionId: classroomResponse.data.source_blueprint_version_id
        ? uuidSchema.parse(classroomResponse.data.source_blueprint_version_id)
        : null,
      actualSiteSlug: classroomResponse.data.actual_site_slug || null,
      actualSitePublished: classroomResponse.data.actual_site_published === true,
    },
    liveCounts: {
      ...Object.fromEntries(liveEntries) as Record<LiveTable, number>,
      assignment_docs: await countRows(supabase, 'assignment_docs', 'assignment_id', assignmentIds),
      submitted_assignment_docs: await countSubmittedAssignmentDocs(supabase, assignmentIds),
      test_attempts: await countRows(supabase, 'test_attempts', 'test_id', testIds),
      test_responses: await countRows(supabase, 'test_responses', 'test_id', testIds),
      announcement_reads: await countRows(
        supabase,
        'announcement_reads',
        'announcement_id',
        announcementIds,
      ),
    },
  }
}

async function probeStudentApiNonVisibility(
  page: Page,
  baseUrl: string,
  classroomId: string,
): Promise<VerificationCheck[]> {
  const studentAuthPath = path.join(process.cwd(), '.auth', 'student.json')
  if (!fs.existsSync(studentAuthPath)) {
    throw new Error(`Student auth state not found: ${studentAuthPath}. Run "pnpm e2e:auth" first.`)
  }
  const browser = page.context().browser()
  if (!browser) throw new Error('Browser instance unavailable for the student visibility probe')

  const studentContext = await browser.newContext({ storageState: studentAuthPath })
  try {
    const endpoints = [
      ['assignments', `/api/student/assignments?classroom_id=${classroomId}`],
      ['Tests', `/api/student/tests?classroom_id=${classroomId}`],
      ['materials', `/api/student/classrooms/${classroomId}/materials`],
      ['surveys', `/api/student/surveys?classroom_id=${classroomId}`],
    ] as const
    const responses = await Promise.all(endpoints.map(async ([label, endpoint]) => ({
      label,
      status: (await studentContext.request.get(`${baseUrl}${endpoint}`)).status(),
    })))

    return responses.map(({ label, status }) => ({
      name: `Student ${label} API cannot expose the rollover classroom`,
      passed: status === 403,
      message: status === 403
        ? undefined
        : `Expected the unenrolled student ${label} request to return 403, received ${status}`,
    }))
  } finally {
    await studentContext.close()
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

function queryLocalJson(databaseUrl: string, sql: string): unknown {
  requireLoopback('Local Supabase database', databaseUrl)
  const output = execFileSync(
    'psql',
    [databaseUrl, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim()
  return JSON.parse(output || '[]')
}

function loadLocalInventory(databaseUrl: string): LocalInventory {
  const idListSchema = z.array(uuidSchema)
  return {
    operationIds: idListSchema.parse(queryLocalJson(
      databaseUrl,
      "select coalesce(jsonb_agg(id::text order by id), '[]'::jsonb) from public.course_blueprint_operations",
    )),
    storageObjectIds: idListSchema.parse(queryLocalJson(
      databaseUrl,
      "select coalesce(jsonb_agg(id::text order by id), '[]'::jsonb) from storage.objects",
    )),
  }
}

const operationResultRowSchema = z.object({
  id: uuidSchema,
  result_blueprint_id: uuidSchema.nullable(),
  result_classroom_id: uuidSchema.nullable(),
})
type OperationResultRow = z.infer<typeof operationResultRowSchema>

export function selectDrillOperationResults(
  operationIds: string[],
  rows: OperationResultRow[],
): { blueprintId: string | null; classroomId: string | null } {
  const expected = new Set(operationIds.map((id) => uuidSchema.parse(id)))
  const drillRows = rows.filter((row) => expected.has(row.id))
  return {
    blueprintId: drillRows.find((row) => row.result_blueprint_id)?.result_blueprint_id || null,
    classroomId: drillRows.find((row) => row.result_classroom_id)?.result_classroom_id || null,
  }
}

function loadLocalDrillOperationResults(
  databaseUrl: string,
  operationIds: string[],
): { blueprintId: string | null; classroomId: string | null } {
  if (operationIds.length === 0) return { blueprintId: null, classroomId: null }
  const rows = z.array(operationResultRowSchema).parse(queryLocalJson(
    databaseUrl,
    `select coalesce(jsonb_agg(jsonb_build_object(
       'id', id,
       'result_blueprint_id', result_blueprint_id,
       'result_classroom_id', result_classroom_id
     ) order by id), '[]'::jsonb)
     from public.course_blueprint_operations
     where id in (${operationIds.map(sqlUuid).join(',')})`,
  ))
  return selectDrillOperationResults(operationIds, rows)
}

async function loadSourceMutableState(
  supabase: ServiceClient,
  classroomId: string,
): Promise<SourceMutableState> {
  const [snapshot, classroomResponse] = await Promise.all([
    loadClassroomSnapshot(supabase, classroomId),
    supabase
      .from('classrooms')
      .select(`
        source_blueprint_id,
        source_blueprint_origin,
        source_blueprint_version_id,
        blueprint_source_revision
      `)
      .eq('id', classroomId)
      .single(),
  ])
  if (classroomResponse.error || !classroomResponse.data) {
    throw new Error(`Could not snapshot source classroom: ${classroomResponse.error?.code || 'missing'}`)
  }

  return {
    classroom: {
      source_blueprint_id: classroomResponse.data.source_blueprint_id
        ? uuidSchema.parse(classroomResponse.data.source_blueprint_id)
        : null,
      source_blueprint_origin: classroomResponse.data.source_blueprint_origin ?? null,
      source_blueprint_version_id: classroomResponse.data.source_blueprint_version_id
        ? uuidSchema.parse(classroomResponse.data.source_blueprint_version_id)
        : null,
      blueprint_source_revision: z.number().int().positive().parse(
        classroomResponse.data.blueprint_source_revision,
      ),
    },
    identities: {
      assignments: identityRows(snapshot.reusable.assignments),
      tests: identityRows(snapshot.reusable.tests),
      lesson_plans: identityRows(snapshot.reusable.lesson_plans),
      classwork_materials: identityRows(snapshot.reusable.classwork_materials),
      surveys: identityRows(snapshot.reusable.surveys),
      assignment_submission_requirements: identityRows(
        snapshot.nested.assignment_submission_requirements,
      ),
      test_questions: identityRows(snapshot.nested.test_questions),
      survey_questions: identityRows(snapshot.nested.survey_questions),
    },
    testDocuments: snapshot.reusable.tests.map((row) => ({
      id: uuidSchema.parse(row.id),
      documents: row.documents ?? [],
    })).sort((left, right) => left.id.localeCompare(right.id)),
  }
}

function nextPosition(rows: Array<Record<string, unknown>>): number {
  return rows.reduce((maximum, row) => Math.max(maximum, Number(row.position) || 0), -1) + 1
}

async function insertSourceFixtures(args: {
  supabase: ServiceClient
  classroomId: string
  source: ClassroomSnapshot
  token: string
  fixtureIds: SourceFixtureIds
}) {
  const { supabase, classroomId, source, token, fixtureIds } = args
  const testIds = source.reusable.tests.map((row) => uuidSchema.parse(row.id))
  const [classroomResponse, enrollmentResponse, attemptsResponse] = await Promise.all([
    supabase.from('classrooms').select('teacher_id').eq('id', classroomId).single(),
    supabase
      .from('classroom_enrollments')
      .select('student_id')
      .eq('classroom_id', classroomId)
      .limit(1)
      .single(),
    supabase.from('test_attempts').select('test_id').in('test_id', testIds),
  ])
  if (classroomResponse.error || !classroomResponse.data) {
    throw new Error(`Could not load fixture teacher: ${classroomResponse.error?.code || 'missing'}`)
  }
  if (enrollmentResponse.error || !enrollmentResponse.data) {
    throw new Error(`Could not load fixture student: ${enrollmentResponse.error?.code || 'missing'}`)
  }
  if (attemptsResponse.error) {
    throw new Error(`Could not load test attempts: ${attemptsResponse.error.code}`)
  }
  const teacherId = uuidSchema.parse(classroomResponse.data.teacher_id)
  const studentId = uuidSchema.parse(enrollmentResponse.data.student_id)
  const attemptedTestIds = new Set(
    (attemptsResponse.data || []).map((row) => uuidSchema.parse(row.test_id)),
  )
  const documentTestId = testIds.find((id) => !attemptedTestIds.has(id))
  if (!documentTestId) {
    throw new Error('The local fixture needs a test without attempts for reusable document coverage')
  }
  const classworkPosition = nextPosition([
    ...source.reusable.assignments,
    ...source.reusable.classwork_materials,
    ...source.reusable.surveys,
  ])

  const fixtureStart = source.settings.startDate && isValid(parseISO(source.settings.startDate))
    ? parseISO(source.settings.startDate)
    : parseISO('2026-01-05')
  const fixtureDueDate = addDays(fixtureStart, 4)
  fixtureDueDate.setHours(14, 35, 0, 0)
  const assignmentResponse = await supabase.from('assignments').insert({
    id: fixtureIds.assignment,
    classroom_id: classroomId,
    title: `${token} Assignment`,
    description: 'Reusable assignment body',
    instructions_markdown: 'Reusable assignment body',
    due_at: fromZonedTime(fixtureDueDate, 'America/Toronto').toISOString(),
    created_by: teacherId,
    points_possible: 17,
    gradebook_weight: 13,
    include_in_final: false,
    is_draft: true,
    track_authenticity: true,
    position: classworkPosition,
  }).select('id').single()
  if (assignmentResponse.error || !assignmentResponse.data) {
    throw new Error(`Could not create assignment fixture: ${assignmentResponse.error?.code || 'missing'}`)
  }

  const materialResponse = await supabase.from('classwork_materials').insert({
    id: fixtureIds.material,
    classroom_id: classroomId,
    title: `${token} Material`,
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reusable material body' }] }],
    },
    is_draft: true,
    position: classworkPosition + 1,
    created_by: teacherId,
  }).select('id').single()
  if (materialResponse.error || !materialResponse.data) {
    throw new Error(`Could not create material fixture: ${materialResponse.error?.code || 'missing'}`)
  }
  const surveyResponse = await supabase.from('surveys').insert({
    id: fixtureIds.survey,
    classroom_id: classroomId,
    title: `${token} Survey`,
    status: 'draft',
    show_results: false,
    dynamic_responses: true,
    position: classworkPosition + 2,
    created_by: teacherId,
  }).select('id').single()
  if (surveyResponse.error || !surveyResponse.data) {
    throw new Error(`Could not create survey fixture: ${surveyResponse.error?.code || 'missing'}`)
  }
  const surveyQuestionResponse = await supabase.from('survey_questions').insert({
    id: fixtureIds.surveyQuestion,
    survey_id: fixtureIds.survey,
    question_type: 'multiple_choice',
    question_text: 'Which rollover detail should be reviewed first?',
    options: ['Dates', 'Release state'],
    position: 0,
  }).select('id').single()
  if (surveyQuestionResponse.error || !surveyQuestionResponse.data) {
    throw new Error(`Could not create survey question fixture: ${surveyQuestionResponse.error?.code || 'missing'}`)
  }
  const requirementResponse = await supabase.from('assignment_submission_requirements').insert({
    id: fixtureIds.requirement,
    assignment_id: fixtureIds.assignment,
    type: 'link',
    label: `${token} Evidence link`,
    instructions: 'Submit the reusable evidence link.',
    required: true,
    position: nextPosition(source.nested.assignment_submission_requirements),
  }).select('id').single()
  if (requirementResponse.error || !requirementResponse.data) {
    throw new Error(`Could not create assignment requirement fixture: ${requirementResponse.error?.code || 'missing'}`)
  }
  const announcementResponse = await supabase.from('announcements').insert({
    id: fixtureIds.announcement,
    classroom_id: classroomId,
    title: `${token} Live announcement`,
    content: 'This live classroom announcement must not be copied.',
    created_by: teacherId,
  }).select('id').single()
  if (announcementResponse.error || !announcementResponse.data) {
    throw new Error(`Could not create announcement fixture: ${announcementResponse.error?.code || 'missing'}`)
  }
  const announcementReadResponse = await supabase.from('announcement_reads').insert({
    id: fixtureIds.announcementRead,
    announcement_id: fixtureIds.announcement,
    user_id: studentId,
  }).select('id').single()
  if (announcementReadResponse.error || !announcementReadResponse.data) {
    throw new Error(`Could not create announcement read fixture: ${announcementReadResponse.error?.code || 'missing'}`)
  }

  const documentResponse = await supabase.from('tests').update({
    documents: [{
      id: fixtureIds.testDocument,
      title: `${token} Reference`,
      source: 'link',
      url: 'https://example.com/rollover-reference',
    }],
  }).eq('id', documentTestId).select('id').single()
  if (documentResponse.error || !documentResponse.data) {
    throw new Error(`Could not create test document fixture: ${documentResponse.error?.code || 'missing'}`)
  }
}

function sqlUuid(value: string): string {
  return `'${uuidSchema.parse(value)}'::uuid`
}

function sqlNullableUuid(value: string | null): string {
  return value ? sqlUuid(value) : 'null::uuid'
}

function sqlJsonb(value: unknown): string {
  if (value === null || value === undefined) return 'null::jsonb'
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`
}

function restoreIdentityStatement(table: IdentityTable, rows: IdentityRow[]): string | null {
  if (rows.length === 0) return null
  const values = rows.map((row) => `(
    ${sqlUuid(row.id)},
    ${sqlUuid(row.artifact_id)},
    ${sqlNullableUuid(row.source_artifact_id)},
    ${sqlNullableUuid(row.source_blueprint_version_id)}
  )`).join(',')
  return `
    update public.${table} as target
    set
      artifact_id = original.artifact_id,
      source_artifact_id = original.source_artifact_id,
      source_blueprint_version_id = original.source_blueprint_version_id
    from (values ${values}) as original(
      id,
      artifact_id,
      source_artifact_id,
      source_blueprint_version_id
    )
    where target.id = original.id
  `
}

function restoreTestDocumentsStatement(
  rows: SourceMutableState['testDocuments'],
): string | null {
  if (rows.length === 0) return null
  const values = rows.map((row) => `(${sqlUuid(row.id)}, ${sqlJsonb(row.documents)})`).join(',')
  return `
    update public.tests as target
    set documents = original.documents
    from (values ${values}) as original(id, documents)
    where target.id = original.id
  `
}

function cleanupLocalDrill(
  databaseUrl: string,
  sourceClassroomId: string | null,
  sourceBaseline: SourceMutableState | null,
  fixtureIds: SourceFixtureIds,
  operationIds: string[],
  classroomId: string | null,
  blueprintId: string | null,
) {
  if (!sourceClassroomId || !sourceBaseline) return
  requireLoopback('Local Supabase database', databaseUrl)
  const verifiedSourceClassroomId = uuidSchema.parse(sourceClassroomId)
  const verifiedClassroomId = classroomId ? uuidSchema.parse(classroomId) : null
  const verifiedBlueprintId = blueprintId ? uuidSchema.parse(blueprintId) : null
  const verifiedOperationIds = operationIds.map((id) => uuidSchema.parse(id))
  const identities = Object.entries(sourceBaseline.identities)
    .map(([table, rows]) => restoreIdentityStatement(table as IdentityTable, rows))
  const statements = [
    'begin',
    "set local pika.course_blueprint_purge_finalize = 'on'",
    "set local pika.identity_mapping = 'on'",
    verifiedOperationIds.length > 0
      ? `delete from public.course_blueprint_operations where id in (${verifiedOperationIds.map(sqlUuid).join(',')})`
      : null,
    verifiedClassroomId ? `delete from public.classrooms where id = '${verifiedClassroomId}'` : null,
    verifiedBlueprintId ? `delete from public.course_blueprints where id = '${verifiedBlueprintId}'` : null,
    fixtureIds.announcementRead
      ? `delete from public.announcement_reads where id = ${sqlUuid(fixtureIds.announcementRead)}`
      : null,
    fixtureIds.announcement
      ? `delete from public.announcements where id = ${sqlUuid(fixtureIds.announcement)}`
      : null,
    fixtureIds.requirement
      ? `delete from public.assignment_submission_requirements where id = ${sqlUuid(fixtureIds.requirement)}`
      : null,
    fixtureIds.assignment
      ? `delete from public.assignments where id = ${sqlUuid(fixtureIds.assignment)}`
      : null,
    fixtureIds.surveyQuestion
      ? `delete from public.survey_questions where id = ${sqlUuid(fixtureIds.surveyQuestion)}`
      : null,
    fixtureIds.survey
      ? `delete from public.surveys where id = ${sqlUuid(fixtureIds.survey)}`
      : null,
    fixtureIds.material
      ? `delete from public.classwork_materials where id = ${sqlUuid(fixtureIds.material)}`
      : null,
    ...identities,
    restoreTestDocumentsStatement(sourceBaseline.testDocuments),
    `
      update public.classrooms
      set
        source_blueprint_id = ${sqlNullableUuid(sourceBaseline.classroom.source_blueprint_id)},
        source_blueprint_origin = ${sqlJsonb(sourceBaseline.classroom.source_blueprint_origin)},
        source_blueprint_version_id = ${sqlNullableUuid(sourceBaseline.classroom.source_blueprint_version_id)},
        blueprint_source_revision = ${sourceBaseline.classroom.blueprint_source_revision}
      where id = ${sqlUuid(verifiedSourceClassroomId)}
    `,
    'commit',
  ].filter(Boolean).join('; ') + ';'

  execFileSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-c', statements], {
    cwd: process.cwd(),
    stdio: 'ignore',
  })
}

async function localCleanupChecks(args: {
  supabase: ServiceClient
  databaseUrl: string
  sourceClassroomId: string
  sourceBaseline: SourceMutableState
  inventoryBaseline: LocalInventory
  fixtureIds: SourceFixtureIds
  classroomId: string | null
  blueprintId: string | null
}): Promise<VerificationCheck[]> {
  const {
    supabase,
    databaseUrl,
    sourceClassroomId,
    sourceBaseline,
    inventoryBaseline,
    fixtureIds,
    classroomId,
    blueprintId,
  } = args
  const [sourceAfter, inventoryAfter] = await Promise.all([
    loadSourceMutableState(supabase, sourceClassroomId),
    Promise.resolve(loadLocalInventory(databaseUrl)),
  ])
  const fixtureLocations = [
    ['assignments', fixtureIds.assignment],
    ['classwork_materials', fixtureIds.material],
    ['surveys', fixtureIds.survey],
    ['survey_questions', fixtureIds.surveyQuestion],
    ['assignment_submission_requirements', fixtureIds.requirement],
    ['announcements', fixtureIds.announcement],
    ['announcement_reads', fixtureIds.announcementRead],
    ['classrooms', classroomId],
    ['course_blueprints', blueprintId],
  ] as const
  const fixtureCounts = await Promise.all(fixtureLocations.map(async ([table, id]) => {
    if (!id) return 0
    const response = await supabase.from(table).select('*', { count: 'exact', head: true }).eq('id', id)
    if (response.error) throw new Error(`Could not verify cleanup for ${table}: ${response.error.code}`)
    return response.count || 0
  }))

  return [
    {
      name: 'Source classroom restored after drill',
      passed: sameValue(sourceAfter, sourceBaseline),
      message: 'Source identity, provenance, or revision state changed after cleanup',
    },
    {
      name: 'Local operation ledger restored after drill',
      passed: sameValue(inventoryAfter.operationIds, inventoryBaseline.operationIds),
      message: 'The drill left or removed course Blueprint operation rows',
    },
    {
      name: 'Local managed storage inventory unchanged',
      passed: sameValue(inventoryAfter.storageObjectIds, inventoryBaseline.storageObjectIds),
      message: 'The drill changed the managed storage object inventory',
    },
    {
      name: 'Local drill fixtures removed',
      passed: fixtureCounts.every((count) => count === 0),
      message: 'At least one temporary rollover fixture remained after cleanup',
    },
  ]
}

export async function runBestEffortRolloverCleanup(args: {
  discoveries: Array<() => Promise<void>>
  cleanup: () => Promise<void> | void
  verify: () => Promise<VerificationCheck[]>
}): Promise<VerificationCheck[]> {
  for (const discover of args.discoveries) {
    try {
      await discover()
    } catch {
      // Cleanup of already-known records must not depend on fallback discovery.
    }
  }
  await args.cleanup()
  return args.verify()
}

function compareReusableStructure(
  checks: VerificationCheck[],
  source: ClassroomSnapshot,
  target: ClassroomSnapshot,
  expectedBlueprintId: string,
  versionBlueprintId: string | null,
) {
  const versionId = target.settings.sourceBlueprintVersionId
  addRequiredCheck(
    checks,
    'Classroom records immutable Blueprint Version lineage',
    Boolean(
      versionId
        && uuidSchema.safeParse(versionId).success
        && versionBlueprintId === expectedBlueprintId,
    ),
    'The rollover classroom Version did not belong to the captured Blueprint',
  )

  for (const table of reusableTables) {
    const sourceTitles = normalizeTitles(source.reusable[table])
    const targetTitles = normalizeTitles(target.reusable[table])
    addRequiredCheck(
      checks,
      `${table} preserved`,
      JSON.stringify(targetTitles) === JSON.stringify(sourceTitles),
      `${table} differed: source=${JSON.stringify(sourceTitles)} target=${JSON.stringify(targetTitles)}`,
    )

    const sourceIdentities = source.reusable[table].map(sourceIdentity).sort()
    addRequiredCheck(
      checks,
      `${table} lineage preserved`,
      JSON.stringify(targetSourceIdentities(target.reusable[table])) === JSON.stringify(sourceIdentities)
        && JSON.stringify(targetArtifactIdentities(target.reusable[table])) === JSON.stringify(sourceIdentities)
        && target.reusable[table].every((row) => row.source_blueprint_version_id === versionId),
      `${table} did not preserve source artifact or Blueprint Version identity`,
    )
  }

  const nestedContracts = [
    ['assignment_submission_requirements', 'assignment_id', 'assignments'],
    ['test_questions', 'test_id', 'tests'],
    ['survey_questions', 'survey_id', 'surveys'],
  ] as const
  for (const [table, parentKey, parentTable] of nestedContracts) {
    addRequiredCheck(
      checks,
      `${table} content preserved`,
      JSON.stringify(normalizeNestedRows(target.nested[table], parentKey))
        === JSON.stringify(normalizeNestedRows(source.nested[table], parentKey)),
      `${table} content differed after rollover`,
    )
    const sourceParentIdentities = new Map(
      source.reusable[parentTable].map((row) => [String(row.id), sourceIdentity(row)]),
    )
    const targetParentIdentities = new Map(
      target.reusable[parentTable].map((row) => [String(row.id), String(row.source_artifact_id || '')]),
    )
    const targetParentArtifacts = new Map(
      target.reusable[parentTable].map((row) => [String(row.id), String(row.artifact_id || '')]),
    )
    const sourceLineagePairs = source.nested[table].map((row) => ({
      childArtifact: sourceIdentity(row),
      childSource: sourceIdentity(row),
      parentArtifact: sourceParentIdentities.get(String(row[parentKey])) || '',
      parentSource: sourceParentIdentities.get(String(row[parentKey])) || '',
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    const targetLineagePairs = target.nested[table].map((row) => ({
      childArtifact: String(row.artifact_id || ''),
      childSource: String(row.source_artifact_id || ''),
      parentArtifact: targetParentArtifacts.get(String(row[parentKey])) || '',
      parentSource: targetParentIdentities.get(String(row[parentKey])) || '',
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    addRequiredCheck(
      checks,
      `${table} lineage preserved`,
      sameValue(targetLineagePairs, sourceLineagePairs)
        && target.nested[table].every((row) => row.source_blueprint_version_id === versionId),
      `${table} did not preserve parent, source artifact, or Blueprint Version identity: source=${JSON.stringify(sourceLineagePairs)} target=${JSON.stringify(targetLineagePairs)} version=${versionId}`,
    )
  }

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

  const sourceTestsByIdentity = new Map(
    source.reusable.tests.map((row) => [sourceIdentity(row), row]),
  )
  addRequiredCheck(
    checks,
    'Reusable test definitions preserved',
    target.reusable.tests.every((row) => {
      const sourceRow = sourceTestsByIdentity.get(String(row.source_artifact_id || ''))
      return Boolean(
        sourceRow
          && sameValue(normalizeTestDefinition(row), normalizeTestDefinition(sourceRow)),
      )
    }),
    'At least one test lost reusable documents, result settings, points, or gradebook configuration',
  )

  const sourceAssignmentsByIdentity = new Map(
    source.reusable.assignments.map((row) => [sourceIdentity(row), row]),
  )
  addRequiredCheck(
    checks,
    'Reusable assignment definitions preserved',
    target.reusable.assignments.every((row) => {
      const sourceRow = sourceAssignmentsByIdentity.get(String(row.source_artifact_id || ''))
      if (!sourceRow) return false
      return sameValue(
        normalizeAssignmentDefinition(row, target.settings.startDate),
        normalizeAssignmentDefinition(sourceRow, source.settings.startDate),
      )
    }),
    'At least one assignment lost reusable instructions, timing, grading, authenticity, or position',
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

  const sourceMaterialsByIdentity = new Map(
    source.reusable.classwork_materials.map((row) => [sourceIdentity(row), row]),
  )
  addRequiredCheck(
    checks,
    'Material content preserved',
    target.reusable.classwork_materials.every((row) => {
      const sourceRow = sourceMaterialsByIdentity.get(String(row.source_artifact_id || ''))
      return Boolean(
        sourceRow
          && row.title === sourceRow.title
          && sameValue(row.content, sourceRow.content)
          && Number(row.position) === Number(sourceRow.position),
      )
    }),
    'At least one material lost or changed its title, content, or position',
  )

  const sourceSurveysByIdentity = new Map(
    source.reusable.surveys.map((row) => [sourceIdentity(row), row]),
  )
  addRequiredCheck(
    checks,
    'Survey settings preserved',
    target.reusable.surveys.every((row) => {
      const sourceRow = sourceSurveysByIdentity.get(String(row.source_artifact_id || ''))
      return Boolean(
        sourceRow
          && row.title === sourceRow.title
          && row.show_results === sourceRow.show_results
          && row.dynamic_responses === sourceRow.dynamic_responses
          && Number(row.position) === Number(sourceRow.position),
      )
    }),
    'At least one survey lost or changed its title, reusable settings, or position',
  )

  for (const check of getStudentFacingDefaultChecks({
    assignments: target.reusable.assignments,
    tests: target.reusable.tests,
    materials: target.reusable.classwork_materials,
    surveys: target.reusable.surveys,
    classroom: {
      actual_site_slug: target.settings.actualSiteSlug,
      actual_site_published: target.settings.actualSitePublished,
    },
  })) {
    addRequiredCheck(checks, check.name, check.passed, check.message || `${check.name} failed`)
  }

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
    let sourceClassroomId: string | null = null
    let sourceBaseline: SourceMutableState | null = null
    let inventoryBaseline: LocalInventory | null = null
    const fixtureIds = createSourceFixtureIds()
    const operationIds: string[] = []
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
      sourceClassroomId = uuidSchema.parse(sourceResponse.data.id)
      token = `Rollover Drill ${Date.now()}`
      const initialSource = await loadClassroomSnapshot(supabase, sourceClassroomId)
      sourceBaseline = await loadSourceMutableState(supabase, sourceClassroomId)
      inventoryBaseline = loadLocalInventory(databaseUrl)
      await insertSourceFixtures({
        supabase,
        classroomId: sourceClassroomId,
        source: initialSource,
        token,
        fixtureIds,
      })
      const source = await loadClassroomSnapshot(supabase, sourceClassroomId)
      const fixtureAssignment = source.reusable.assignments.find((row) => row.id === fixtureIds.assignment)
      const fixtureMaterial = source.reusable.classwork_materials.find((row) => row.id === fixtureIds.material)
      const fixtureSurvey = source.reusable.surveys.find((row) => row.id === fixtureIds.survey)
      addRequiredCheck(
        checks,
        'Source fixture contains reusable structure',
        source.reusable.assignments.length > 0
          && source.reusable.tests.length > 0
          && source.reusable.lesson_plans.length > 0
          && source.reusable.classwork_materials.length > 0
          && source.reusable.surveys.length > 0
          && source.reusable.tests.some((row) => (
            Array.isArray(row.documents) && row.documents.length > 0
          ))
          && source.nested.assignment_submission_requirements.length > 0
          && source.nested.test_questions.length > 0
          && source.nested.survey_questions.length > 0,
        'The local fixture needs every reusable parent and nested resource type',
      )
      addRequiredCheck(
        checks,
        'Source fixtures exercise reusable parent configuration',
        Boolean(
          fixtureAssignment
            && fixtureAssignment.due_at
            && fixtureAssignment.points_possible === 17
            && fixtureAssignment.gradebook_weight === 13
            && fixtureAssignment.include_in_final === false
            && fixtureAssignment.track_authenticity === true
            && fixtureMaterial
            && Number(fixtureMaterial.position) > 0
            && fixtureSurvey
            && fixtureSurvey.show_results === false
            && fixtureSurvey.dynamic_responses === true
            && Number(fixtureSurvey.position) > Number(fixtureMaterial.position),
        ),
        'The local fixtures need non-default assignment, material, and survey configuration',
      )
      addRequiredCheck(
        checks,
        'Source fixture contains live student data',
        source.liveCounts.classroom_enrollments > 0
          && source.liveCounts.classroom_roster > 0
          && source.liveCounts.entries > 0
          && source.liveCounts.submitted_assignment_docs > 0
          && source.liveCounts.test_attempts > 0
          && source.liveCounts.test_responses > 0
          && source.liveCounts.announcements > 0
          && source.liveCounts.announcement_reads > 0,
        'The local fixture needs enrollments, logs, submissions, attempts, and announcement state',
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

      const artifactDir = path.resolve(process.cwd(), 'artifacts', 'blueprint-rollover', token.replaceAll(' ', '-'))
      fs.mkdirSync(artifactDir, { recursive: true })

      await page.goto(`${baseUrl}/classrooms/${sourceClassroomId}?tab=settings&section=reuse`)
      await page.getByRole('button', { name: 'Save as Course Blueprint' })
        .waitFor({ state: 'visible', timeout: TIMEOUTS.NAVIGATION })
      await page.getByRole('button', { name: 'Save as Course Blueprint' }).click()
      await page.getByLabel('Course Blueprint Title').fill(token)
      const captureUrl = `/api/teacher/classrooms/${sourceClassroomId}/blueprint`
      await installOperationIdentityGuard(page, [captureUrl, '/instantiate'], operationIds)
      const operationInventoryBeforeProbe = loadLocalInventory(databaseUrl).operationIds
      const missingIdentityBlocked = await page.evaluate(async (url) => {
        try {
          await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Must not reach the mutation endpoint' }),
          })
          return false
        } catch {
          return true
        }
      }, captureUrl)
      addRequiredCheck(
        checks,
        'Missing operation identity blocked before mutation',
        missingIdentityBlocked
          && sameValue(loadLocalInventory(databaseUrl).operationIds, operationInventoryBeforeProbe),
        'A browser request without an idempotency key reached the mutation endpoint',
      )
      const captureRequestPromise = page.waitForRequest((request) => (
        request.method() === 'POST' && request.url().endsWith(captureUrl)
      ))
      const capturePromise = page.waitForResponse((response) => (
        response.request().method() === 'POST' && response.url().endsWith(captureUrl)
      ))
      await page.getByRole('button', { name: 'Save Blueprint' }).click()
      const captureRequest = await captureRequestPromise
      const captureOperationId = uuidSchema.parse(captureRequest.headers()['idempotency-key'])
      if (!operationIds.includes(captureOperationId)) {
        throw new Error('Blueprint capture was dispatched before its operation ID was recorded')
      }
      const captureResponse = await capturePromise
      const capturePayload = await captureResponse.json()
      const captureEnvelope = operationResponseSchema.parse(capturePayload)
      if (captureEnvelope.operation_id && captureEnvelope.operation_id !== captureOperationId) {
        throw new Error('Blueprint capture returned a different operation ID than the browser sent')
      }
      if (!captureResponse.ok()) {
        throw new Error(
          `Blueprint capture failed with ${captureResponse.status()}: ${captureEnvelope.error || 'unknown error'}`,
        )
      }
      const captured = captureResponseSchema.parse(capturePayload)
      blueprintId = captured.blueprint_id
      await page.waitForURL(/\/teacher\/blueprints\?/, { timeout: TIMEOUTS.NAVIGATION })
      await page.getByText(`${source.reusable.assignments.length} assignments`, { exact: false })
        .waitFor({ state: 'visible', timeout: TIMEOUTS.ELEMENT_VISIBLE })
      const blueprintScreenshot = path.join(artifactDir, '01-blueprint-review.png')
      await page.screenshot({ path: blueprintScreenshot, fullPage: true })
      artifacts.push(blueprintScreenshot)

      await page.getByRole('button', { name: 'Create classroom from blueprint' }).click()
      classroomTitle = `${token} Classroom`
      await page.getByLabel('Classroom Name').fill(classroomTitle)
      await page.getByRole('button', { name: 'Next' }).click()
      await page.getByText('Choose Calendar', { exact: true })
        .waitFor({ state: 'visible', timeout: TIMEOUTS.ELEMENT_VISIBLE })
      addRequiredCheck(
        checks,
        'Preselected Blueprint skips redundant source selection',
        await page.getByRole('combobox', { name: 'Course Blueprint' }).count() === 0,
        'The direct Blueprint entry path still exposed a redundant source picker',
      )
      const instantiateUrl = `/api/teacher/course-blueprints/${blueprintId}/instantiate`
      const instantiateRequestPromise = page.waitForRequest((request) => (
        request.method() === 'POST' && request.url().endsWith(instantiateUrl)
      ))
      const instantiatePromise = page.waitForResponse((response) => (
        response.request().method() === 'POST' && response.url().endsWith(instantiateUrl)
      ))
      await page.getByRole('button', { name: 'Create' }).click()
      const instantiateRequest = await instantiateRequestPromise
      const instantiateOperationId = uuidSchema.parse(
        instantiateRequest.headers()['idempotency-key'],
      )
      if (!operationIds.includes(instantiateOperationId)) {
        throw new Error('Blueprint instantiation was dispatched before its operation ID was recorded')
      }
      const instantiateResponse = await instantiatePromise
      const instantiatePayload = await instantiateResponse.json()
      const instantiateEnvelope = operationResponseSchema.parse(instantiatePayload)
      if (
        instantiateEnvelope.operation_id
        && instantiateEnvelope.operation_id !== instantiateOperationId
      ) {
        throw new Error('Blueprint instantiation returned a different operation ID than the browser sent')
      }
      if (!instantiateResponse.ok()) {
        throw new Error(
          `Blueprint instantiation failed with ${instantiateResponse.status()}: ${instantiateEnvelope.error || 'unknown error'}`,
        )
      }
      const instantiated = instantiateResponseSchema.parse(instantiatePayload)
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
      const studentVisibilityChecks = await probeStudentApiNonVisibility(page, baseUrl, classroomId)
      for (const check of studentVisibilityChecks) {
        addRequiredCheck(checks, check.name, check.passed, check.message || `${check.name} failed`)
      }
      let versionBlueprintId: string | null = null
      if (target.settings.sourceBlueprintVersionId) {
        const versionResponse = await supabase
          .from('course_blueprint_versions')
          .select('course_blueprint_id')
          .eq('id', target.settings.sourceBlueprintVersionId)
          .single()
        if (versionResponse.error || !versionResponse.data) {
          throw new Error(`Could not load rollover Blueprint Version: ${versionResponse.error?.code || 'missing'}`)
        }
        versionBlueprintId = uuidSchema.parse(versionResponse.data.course_blueprint_id)
      }
      compareReusableStructure(checks, source, target, blueprintId, versionBlueprintId)
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    } finally {
      const discoveries: Array<() => Promise<void>> = []
      if (databaseUrl && operationIds.length > 0) {
        const cleanupDatabaseUrl = databaseUrl
        const cleanupOperationIds = [...operationIds]
        discoveries.push(async () => {
          const results = loadLocalDrillOperationResults(
            cleanupDatabaseUrl,
            cleanupOperationIds,
          )
          blueprintId ||= results.blueprintId
          classroomId ||= results.classroomId
        })
      }

      try {
        const cleanupChecks = await runBestEffortRolloverCleanup({
          discoveries,
          cleanup: () => {
            if (!databaseUrl) return
            cleanupLocalDrill(
              databaseUrl,
              sourceClassroomId,
              sourceBaseline,
              fixtureIds,
              operationIds,
              classroomId,
              blueprintId,
            )
          },
          verify: async () => {
            if (!supabase || !databaseUrl || !sourceClassroomId || !sourceBaseline || !inventoryBaseline) {
              return []
            }
            return localCleanupChecks({
              supabase,
              databaseUrl,
              sourceClassroomId,
              sourceBaseline,
              inventoryBaseline,
              fixtureIds,
              classroomId,
              blueprintId,
            })
          },
        })
        checks.push(...cleanupChecks)
        const failedCleanupCheck = cleanupChecks.find((check) => !check.passed)
        if (failedCleanupCheck) throw new Error(failedCleanupCheck.message)
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
