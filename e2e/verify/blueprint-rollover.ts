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
}

type LocalInventory = {
  operationIds: string[]
  storageObjectIds: string[]
}

type SourceFixtureIds = Partial<Record<
  'material' | 'survey' | 'surveyQuestion' | 'requirement' | 'announcement' | 'announcementRead',
  string
>>

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
    sourceBlueprintVersionId: string | null
  }
  liveCounts: Record<LiveTable | 'announcement_reads' | 'assignment_docs' | 'test_attempts', number>
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

function sourceIdentity(row: Record<string, unknown>): string {
  return String(row.source_artifact_id || row.artifact_id || row.id || '')
}

function targetSourceIdentities(rows: Array<Record<string, unknown>>): string[] {
  return rows.map((row) => String(row.source_artifact_id || '')).sort()
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

async function loadClassroomSnapshot(
  supabase: ServiceClient,
  classroomId: string,
): Promise<ClassroomSnapshot> {
  const [classroomResponse, resourcesResponse, gradingResponse] = await Promise.all([
    supabase
      .from('classrooms')
      .select('course_overview_markdown, course_outline_markdown, source_blueprint_version_id')
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
      sourceBlueprintVersionId: classroomResponse.data.source_blueprint_version_id
        ? uuidSchema.parse(classroomResponse.data.source_blueprint_version_id)
        : null,
    },
    liveCounts: {
      ...Object.fromEntries(liveEntries) as Record<LiveTable, number>,
      assignment_docs: await countRows(supabase, 'assignment_docs', 'assignment_id', assignmentIds),
      test_attempts: await countRows(supabase, 'test_attempts', 'test_id', testIds),
      announcement_reads: await countRows(
        supabase,
        'announcement_reads',
        'announcement_id',
        announcementIds,
      ),
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

function findLocalDrillOperationIds(args: {
  databaseUrl: string
  baselineIds: string[]
  sourceClassroomId: string
  classroomId: string | null
  blueprintId: string | null
}): string[] {
  const { databaseUrl, baselineIds, sourceClassroomId, classroomId, blueprintId } = args
  const baselineSql = baselineIds.length > 0
    ? baselineIds.map(sqlUuid).join(',')
    : 'null::uuid'
  const ownershipPredicates = [
    `source_classroom_id = ${sqlUuid(sourceClassroomId)}`,
    classroomId ? `result_classroom_id = ${sqlUuid(classroomId)}` : null,
    blueprintId ? `source_blueprint_id = ${sqlUuid(blueprintId)}` : null,
    blueprintId ? `result_blueprint_id = ${sqlUuid(blueprintId)}` : null,
  ].filter(Boolean).join(' or ')
  return z.array(uuidSchema).parse(queryLocalJson(
    databaseUrl,
    `select coalesce(jsonb_agg(id::text order by id), '[]'::jsonb)
     from public.course_blueprint_operations
     where id not in (${baselineSql}) and (${ownershipPredicates})`,
  ))
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
  const assignmentIds = source.reusable.assignments.map((row) => uuidSchema.parse(row.id))
  const [classroomResponse, enrollmentResponse, submittedDocsResponse] = await Promise.all([
    supabase.from('classrooms').select('teacher_id').eq('id', classroomId).single(),
    supabase
      .from('classroom_enrollments')
      .select('student_id')
      .eq('classroom_id', classroomId)
      .limit(1)
      .single(),
    supabase
      .from('assignment_docs')
      .select('assignment_id')
      .in('assignment_id', assignmentIds)
      .eq('is_submitted', true),
  ])
  if (classroomResponse.error || !classroomResponse.data) {
    throw new Error(`Could not load fixture teacher: ${classroomResponse.error?.code || 'missing'}`)
  }
  if (enrollmentResponse.error || !enrollmentResponse.data) {
    throw new Error(`Could not load fixture student: ${enrollmentResponse.error?.code || 'missing'}`)
  }
  if (submittedDocsResponse.error) {
    throw new Error(`Could not load submitted assignment docs: ${submittedDocsResponse.error.code}`)
  }
  const teacherId = uuidSchema.parse(classroomResponse.data.teacher_id)
  const studentId = uuidSchema.parse(enrollmentResponse.data.student_id)
  const submittedAssignmentIds = new Set(
    (submittedDocsResponse.data || []).map((row) => uuidSchema.parse(row.assignment_id)),
  )
  const assignmentId = assignmentIds.find((id) => !submittedAssignmentIds.has(id))
  if (!assignmentId) {
    throw new Error('The local fixture needs an assignment without submitted documents')
  }
  const classworkPosition = nextPosition([
    ...source.reusable.assignments,
    ...source.reusable.classwork_materials,
    ...source.reusable.surveys,
  ])

  const materialResponse = await supabase.from('classwork_materials').insert({
    classroom_id: classroomId,
    title: `${token} Material`,
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reusable material body' }] }],
    },
    is_draft: true,
    position: classworkPosition,
    created_by: teacherId,
  }).select('id').single()
  if (materialResponse.error || !materialResponse.data) {
    throw new Error(`Could not create material fixture: ${materialResponse.error?.code || 'missing'}`)
  }
  fixtureIds.material = uuidSchema.parse(materialResponse.data.id)

  const surveyResponse = await supabase.from('surveys').insert({
    classroom_id: classroomId,
    title: `${token} Survey`,
    status: 'draft',
    show_results: false,
    dynamic_responses: true,
    position: classworkPosition + 1,
    created_by: teacherId,
  }).select('id').single()
  if (surveyResponse.error || !surveyResponse.data) {
    throw new Error(`Could not create survey fixture: ${surveyResponse.error?.code || 'missing'}`)
  }
  fixtureIds.survey = uuidSchema.parse(surveyResponse.data.id)

  const surveyQuestionResponse = await supabase.from('survey_questions').insert({
    survey_id: fixtureIds.survey,
    question_type: 'multiple_choice',
    question_text: 'Which rollover detail should be reviewed first?',
    options: ['Dates', 'Release state'],
    position: 0,
  }).select('id').single()
  if (surveyQuestionResponse.error || !surveyQuestionResponse.data) {
    throw new Error(`Could not create survey question fixture: ${surveyQuestionResponse.error?.code || 'missing'}`)
  }
  fixtureIds.surveyQuestion = uuidSchema.parse(surveyQuestionResponse.data.id)

  const requirementResponse = await supabase.from('assignment_submission_requirements').insert({
    assignment_id: assignmentId,
    type: 'link',
    label: `${token} Evidence link`,
    instructions: 'Submit the reusable evidence link.',
    required: true,
    position: nextPosition(source.nested.assignment_submission_requirements),
  }).select('id').single()
  if (requirementResponse.error || !requirementResponse.data) {
    throw new Error(`Could not create assignment requirement fixture: ${requirementResponse.error?.code || 'missing'}`)
  }
  fixtureIds.requirement = uuidSchema.parse(requirementResponse.data.id)

  const announcementResponse = await supabase.from('announcements').insert({
    classroom_id: classroomId,
    title: `${token} Live announcement`,
    content: 'This live classroom announcement must not be copied.',
    created_by: teacherId,
  }).select('id').single()
  if (announcementResponse.error || !announcementResponse.data) {
    throw new Error(`Could not create announcement fixture: ${announcementResponse.error?.code || 'missing'}`)
  }
  fixtureIds.announcement = uuidSchema.parse(announcementResponse.data.id)

  const announcementReadResponse = await supabase.from('announcement_reads').insert({
    announcement_id: fixtureIds.announcement,
    user_id: studentId,
  }).select('id').single()
  if (announcementReadResponse.error || !announcementReadResponse.data) {
    throw new Error(`Could not create announcement read fixture: ${announcementReadResponse.error?.code || 'missing'}`)
  }
  fixtureIds.announcementRead = uuidSchema.parse(announcementReadResponse.data.id)
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

function compareReusableStructure(
  checks: VerificationCheck[],
  source: ClassroomSnapshot,
  target: ClassroomSnapshot,
) {
  const versionId = target.settings.sourceBlueprintVersionId
  addRequiredCheck(
    checks,
    'Classroom records immutable Blueprint Version lineage',
    Boolean(versionId && uuidSchema.safeParse(versionId).success),
    'The rollover classroom did not record its immutable Blueprint Version',
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
        && target.reusable[table].every((row) => row.source_blueprint_version_id === versionId),
      `${table} did not preserve source artifact or Blueprint Version identity`,
    )
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
    addRequiredCheck(
      checks,
      `${table} lineage preserved`,
      sameValue(
        targetSourceIdentities(target.nested[table]),
        source.nested[table].map(sourceIdentity).sort(),
      ) && target.nested[table].every((row) => row.source_blueprint_version_id === versionId),
      `${table} did not preserve source artifact or Blueprint Version identity`,
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

  const sourceMaterialsByIdentity = new Map(
    source.reusable.classwork_materials.map((row) => [sourceIdentity(row), row]),
  )
  addRequiredCheck(
    checks,
    'Material content preserved',
    target.reusable.classwork_materials.every((row) => {
      const sourceRow = sourceMaterialsByIdentity.get(String(row.source_artifact_id || ''))
      return Boolean(sourceRow && sameValue(row.content, sourceRow.content))
    }),
    'At least one material lost or changed its content',
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
          && row.show_results === sourceRow.show_results
          && row.dynamic_responses === sourceRow.dynamic_responses,
      )
    }),
    'At least one survey lost or changed its reusable settings',
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
    let sourceClassroomId: string | null = null
    let sourceBaseline: SourceMutableState | null = null
    let inventoryBaseline: LocalInventory | null = null
    const fixtureIds: SourceFixtureIds = {}
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
      addRequiredCheck(
        checks,
        'Source fixture contains reusable structure',
        source.reusable.assignments.length > 0
          && source.reusable.tests.length > 0
          && source.reusable.lesson_plans.length > 0
          && source.reusable.classwork_materials.length > 0
          && source.reusable.surveys.length > 0
          && source.nested.assignment_submission_requirements.length > 0
          && source.nested.test_questions.length > 0
          && source.nested.survey_questions.length > 0,
        'The local fixture needs every reusable parent and nested resource type',
      )
      addRequiredCheck(
        checks,
        'Source fixture contains live student data',
        source.liveCounts.classroom_enrollments > 0
          && source.liveCounts.entries > 0
          && source.liveCounts.assignment_docs > 0
          && source.liveCounts.test_attempts > 0
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
      const capturePromise = page.waitForResponse((response) => (
        response.request().method() === 'POST'
          && response.url().endsWith(`/api/teacher/classrooms/${sourceClassroomId}/blueprint`)
      ))
      await page.getByRole('button', { name: 'Save Blueprint' }).click()
      const captureResponse = await capturePromise
      const capturePayload = await captureResponse.json()
      const captureEnvelope = operationResponseSchema.parse(capturePayload)
      if (captureEnvelope.operation_id) operationIds.push(captureEnvelope.operation_id)
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
      const instantiatePayload = await instantiateResponse.json()
      const instantiateEnvelope = operationResponseSchema.parse(instantiatePayload)
      if (instantiateEnvelope.operation_id) operationIds.push(instantiateEnvelope.operation_id)
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
        if (databaseUrl && sourceClassroomId && inventoryBaseline) {
          const discoveredOperationIds = findLocalDrillOperationIds({
            databaseUrl,
            baselineIds: inventoryBaseline.operationIds,
            sourceClassroomId,
            classroomId,
            blueprintId,
          })
          operationIds.push(...discoveredOperationIds.filter((id) => !operationIds.includes(id)))
        }
        if (databaseUrl) {
          cleanupLocalDrill(
            databaseUrl,
            sourceClassroomId,
            sourceBaseline,
            fixtureIds,
            operationIds,
            classroomId,
            blueprintId,
          )
        }
        if (supabase && databaseUrl && sourceClassroomId && sourceBaseline && inventoryBaseline) {
          const cleanupChecks = await localCleanupChecks({
            supabase,
            databaseUrl,
            sourceClassroomId,
            sourceBaseline,
            inventoryBaseline,
            fixtureIds,
            classroomId,
            blueprintId,
          })
          checks.push(...cleanupChecks)
          const failedCleanupCheck = cleanupChecks.find((check) => !check.passed)
          if (failedCleanupCheck) throw new Error(failedCleanupCheck.message)
        }
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
