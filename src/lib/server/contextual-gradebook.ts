import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { isGradebookMaximumEditingEnabled } from '@/lib/server/gradebook-maximum'
import { projectOwnerGradebook } from '@/lib/gradebook-projection'
import { projectMemberGrades, projectMemberGradebookItems } from '@/lib/gradebook-member-projection'
import {
  contextualGradebookOwnerEnvelopeSchema, contextualGradebookMemberGradesEnvelopeSchema,
  contextualGradebookMemberItemsEnvelopeSchema, contextualGradebookMutationEnvelopeSchema,
  contextualGradebookMutationPayloadSchema, GRADEBOOK_LIMITS,
  type GradebookOwnerSource, type GradebookMemberSource, type GradebookMutationAction,
} from '@/lib/validations/contextual-gradebook'
import type { Database } from '@/types/database'
import type { GradebookPatchCommand, GradebookCategoriesPutCommand } from '@/lib/validations/gradebook'
import type { GradebookScoreOverridePutCommand, GradebookScoreOverrideDeleteCommand } from '@/lib/validations/gradebook-score-overrides'
import type { GradebookItemMutation, GradebookItemScore } from '@/lib/validations/gradebook-items'
import type { GradebookMaximumPut } from '@/lib/validations/gradebook-maximum'

const unavailable = () => new ApiError(503, 'Gradebook operation unavailable')
const uuid = z.uuid().transform(value => value.toLowerCase())
const identity = z.object({ actorId: uuid, classroomId: uuid })
type Context = { actorId: string; classroomId: string; signal?: AbortSignal; deadline?: number }
type RpcName = 'get_gradebook_for_owner_v1' | 'get_gradebook_for_member_v1' | 'mutate_gradebook_for_owner_v1'
type GradebookRpcClient = {
  rpc<Name extends RpcName>(name: Name, args: Database['public']['Functions'][Name]['Args']): { abortSignal(signal: AbortSignal): PromiseLike<unknown> }
}
const rpcEnvelope = z.object({
  data: z.unknown(), error: z.object({ code: z.string(), message: z.string(), details: z.string().nullable().optional(), hint: z.string().nullable().optional() }).strict().nullable(),
  status: z.number().int(), statusText: z.string().optional(), count: z.number().int().nullable().optional(),
}).strict()

export async function authorizeSharedGradebookActor() {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' as const }
  const user = await requireAuth()
  return (await resolveClassroomExperienceAdmission(user)).status === 'admitted'
    ? { mode: 'shared' as const, user } : { mode: 'existing' as const }
}

/** Bounds parsed SDK objects before Zod clones them. The separate fetch below
 * bounds wire allocation; this traversal is not a transport allocation guard. */
function boundedJson(value: unknown, maximumBytes: number): boolean {
  const stack: Array<{ value: unknown; depth: number; leave?: boolean }> = [{ value, depth: 0 }]
  const ancestors = new Set<object>()
  let nodes = 0, bytes = 0
  while (stack.length) {
    const current = stack.pop()!
    if (current.leave && current.value !== null && typeof current.value === 'object') { ancestors.delete(current.value); continue }
    if (++nodes > 6_000_000 || current.depth > 12 || bytes > maximumBytes) return false
    if (current.value === null || typeof current.value === 'boolean') { bytes += current.value === false ? 5 : 4; continue }
    if (typeof current.value === 'string') {
      if (Buffer.byteLength(current.value, 'utf8') > GRADEBOOK_LIMITS.stringBytes) return false
      bytes += Buffer.byteLength(JSON.stringify(current.value), 'utf8'); continue
    }
    if (typeof current.value === 'number') { if (!Number.isFinite(current.value)) return false; bytes += Buffer.byteLength(JSON.stringify(current.value), 'utf8'); continue }
    if (typeof current.value !== 'object' || ancestors.has(current.value)) return false
    if (Array.isArray(current.value)) { if (current.value.length > GRADEBOOK_LIMITS.test_responses) return false }
    else if (Object.getPrototypeOf(current.value) !== Object.prototype || Object.keys(current.value).length > 32) return false
    const keys = Object.keys(current.value)
    bytes += 2 + Math.max(0, (Array.isArray(current.value) ? current.value.length : keys.length) - 1)
    if (!Array.isArray(current.value)) for (const key of keys) bytes += Buffer.byteLength(JSON.stringify(key), 'utf8') + 1
    // JSON serializes an acyclic shared value at every occurrence. Only a
    // reference to an active ancestor is a cycle; count repeated branches fully.
    ancestors.add(current.value)
    stack.push({ value: current.value, depth: current.depth, leave: true })
    for (const child of Object.values(current.value)) stack.push({ value: child, depth: current.depth + 1 })
  }
  if (bytes > maximumBytes) return false
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8') <= maximumBytes } catch { return false }
}

/** Feature-local stream cap before PostgREST calls response.json(). */
function cappedFetch(signal: AbortSignal): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, { ...init, signal })
    const reader = response.body?.getReader()
    if (!reader) throw unavailable()
    const chunks: Uint8Array[] = []; let bytes = 0
    const abort = () => { void reader.cancel().catch(() => {}) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      for (;;) {
        if (signal.aborted) throw unavailable()
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > GRADEBOOK_LIMITS.transportBytes) throw unavailable()
        chunks.push(new Uint8Array(value))
      }
      if (signal.aborted) throw unavailable()
      const body = new Uint8Array(bytes)
      let offset = 0
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
    } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock() }
  }
}

async function invoke<Name extends RpcName, Schema extends z.ZodType>(context: Context, name: Name, args: Database['public']['Functions'][Name]['Args'], schema: Schema): Promise<z.infer<Schema>> {
  const deadline = Math.min(context.deadline ?? Infinity, Date.now() + GRADEBOOK_LIMITS.lifetimeMs)
  const controller = new AbortController(), abort = () => controller.abort()
  context.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, Math.max(0, deadline - Date.now()))
  try {
    if (!Number.isFinite(deadline) || Date.now() >= deadline || context.signal?.aborted) throw unavailable()
    const client: GradebookRpcClient = getServiceRoleClient({ fetch: cappedFetch(controller.signal) })
    const pending = client.rpc(name, { ...args, p_deadline: new Date(deadline).toISOString() }).abortSignal(controller.signal)
    const raw = await Promise.race([pending, new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(unavailable()), { once: true })
      if (controller.signal.aborted) reject(unavailable())
    })])
    if (controller.signal.aborted || Date.now() >= deadline || !boundedJson(raw, GRADEBOOK_LIMITS.transportBytes)) throw unavailable()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw unavailable()
    const envelope = rpcEnvelope.safeParse(raw)
    if (!envelope.success || !Object.hasOwn(raw, 'data') || !Object.hasOwn(raw, 'error')) throw unavailable()
    const { data, error, status } = envelope.data
    if (error) {
      const statuses: Record<string, { http: number; api: number }> = {
        PT400: { http: 400, api: 400 }, PT403: { http: 403, api: 403 }, PT404: { http: 404, api: 404 }, PT409: { http: 409, api: 409 },
        '55000': { http: 500, api: 409 },
      }
      const mapping = statuses[error.code], mapped = mapping?.api
      if (data !== null || !mapping || status !== mapping.http) throw unavailable()
      throw new ApiError(mapped, mapped === 400 ? 'Invalid Gradebook operation' : mapped === 403 ? 'Forbidden' : mapped === 404 ? 'Gradebook resource not found' : 'Gradebook changed; reload and retry')
    }
    if (status < 200 || status > 299 || data == null || !boundedJson(data, GRADEBOOK_LIMITS.sourceBytes)) throw unavailable()
    // Check explicit row bytes/counts before schema cloning and projection.
    if (typeof data === 'object' && 'source' in data && data.source && typeof data.source === 'object') {
      let expandedBytes = 0
      for (const [key, rows] of Object.entries(data.source)) {
        if (!Array.isArray(rows)) continue
        const cap = GRADEBOOK_LIMITS[key as keyof typeof GRADEBOOK_LIMITS]
        if (typeof cap !== 'number' || rows.length > cap) throw unavailable()
        for (const row of rows) expandedBytes += Buffer.byteLength(JSON.stringify(row), 'utf8')
      }
      if (expandedBytes > GRADEBOOK_LIMITS.expandedBytes) throw unavailable()
    }
    const decoded = schema.safeParse(data)
    if (!decoded.success) throw unavailable()
    return decoded.data
  } catch (error) { if (error instanceof ApiError) throw error; throw unavailable() }
  finally { clearTimeout(timer); context.signal?.removeEventListener('abort', abort); controller.abort() }
}

function ids(input: Context) {
  const parsed = identity.safeParse(input)
  if (!parsed.success) throw new ApiError(400, 'Invalid Gradebook identifiers')
  return parsed.data
}
function checkClassroom(data: { actor_id: string; classroom: { id: string; teacher_id: string; archived_at: string | null } }, actor: string, classroom: string, owner: boolean, mutating = false) {
  if (data.actor_id !== actor || data.classroom.id !== classroom || (owner ? data.classroom.teacher_id !== actor : data.classroom.teacher_id === actor)
    || ((!owner || mutating) && data.classroom.archived_at !== null)) throw unavailable()
}
function unique<T>(rows: T[], key: (row: T) => string) {
  const keys = rows.map(key); if (new Set(keys).size !== rows.length) throw unavailable()
  return new Set(keys)
}
function checkSource(source: GradebookOwnerSource | GradebookMemberSource, classroom: string, students: Set<string>) {
  const assignments = unique(source.assignments, row => row.id), tests = unique(source.tests, row => row.id), items = unique(source.items, row => row.id)
  if (assignments.size + tests.size + items.size > GRADEBOOK_LIMITS.assessments) throw unavailable()
  const categories = unique(source.categories, row => row.id)
  for (const row of [...source.assignments, ...source.tests, ...source.items, ...source.categories]) {
    if (row.classroom_id !== classroom || ('gradebook_category_id' in row && row.gradebook_category_id !== null && !categories.has(row.gradebook_category_id))) throw unavailable()
  }
  unique(source.assignment_docs, row => row.assignment_id + ':' + row.student_id)
  for (const row of source.assignment_docs) if (!assignments.has(row.assignment_id) || !students.has(row.student_id)) throw unavailable()
  const questions = new Map(source.test_questions.map(row => [row.id, row.test_id]))
  unique(source.test_questions, row => row.id)
  const counts = new Map<string, number>()
  for (const row of source.test_questions) {
    const count = (counts.get(row.test_id) ?? 0) + 1; counts.set(row.test_id, count)
    if (!tests.has(row.test_id) || count > GRADEBOOK_LIMITS.questionsPerTest) throw unavailable()
  }
  unique(source.test_responses, row => row.test_id + ':' + row.question_id + ':' + row.student_id)
  for (const row of source.test_responses) if (!tests.has(row.test_id) || questions.get(row.question_id) !== row.test_id || !students.has(row.student_id)) throw unavailable()
  unique(source.test_attempts, row => row.test_id + ':' + row.student_id)
  for (const row of source.test_attempts) if (!tests.has(row.test_id) || !students.has(row.student_id)) throw unavailable()
  unique(source.item_scores, row => row.item_id + ':' + row.student_id)
  for (const row of source.item_scores) if (!items.has(row.item_id) || row.classroom_id !== classroom || !students.has(row.student_id)) throw unavailable()
  unique(source.score_overrides, row => row.assessment_type + ':' + row.assessment_id + ':' + row.student_id)
  for (const row of source.score_overrides) if (row.classroom_id !== classroom || !students.has(row.student_id)
    || !(row.assessment_type === 'assignment' ? assignments.has(row.assessment_id) : row.assessment_type === 'test' ? tests.has(row.assessment_id) : row.assessment_id === classroom)) throw unavailable()
}
function complete<T>(result: T, context: Context): T {
  if (!boundedJson(result, GRADEBOOK_LIMITS.sourceBytes) || context.signal?.aborted || Date.now() >= (context.deadline ?? 0)) throw unavailable()
  return result
}

export async function readContextualGradebookOwner(input: Context & { selectedStudentId: string | null }) {
  input = { ...input, deadline: Math.min(input.deadline ?? Infinity, Date.now() + GRADEBOOK_LIMITS.lifetimeMs) }
  const { actorId, classroomId } = ids(input)
  const selection = input.selectedStudentId === null ? null : uuid.parse(input.selectedStudentId)
  const data = await invoke(input, 'get_gradebook_for_owner_v1', { p_actor_id: actorId, p_classroom_id: classroomId, p_selected_student_id: selection, p_deadline: '' }, contextualGradebookOwnerEnvelopeSchema)
  checkClassroom(data, actorId, classroomId, true)
  if (data.selected_student_id !== selection) throw unavailable()
  const students = unique(data.source.roster, row => row.student_id)
  if (students.has(actorId) || (selection !== null && !students.has(selection)) || students.size * (data.source.assignments.length + data.source.tests.length + data.source.items.length) > GRADEBOOK_LIMITS.ownerCells) throw unavailable()
  unique(data.source.profiles, row => row.user_id)
  if (data.source.profiles.some(row => !students.has(row.user_id))) throw unavailable()
  checkSource(data.source, classroomId, students)
  return complete(projectOwnerGradebook(data.source, { categories: true, scoreOverrides: true, maximumOverrides: true, items: true }, classroomId, selection, isGradebookMaximumEditingEnabled()), input)
}

export async function readContextualGradebookMember(input: Context & { view: 'grades' | 'items' }) {
  input = { ...input, deadline: Math.min(input.deadline ?? Infinity, Date.now() + GRADEBOOK_LIMITS.lifetimeMs) }
  const { actorId, classroomId } = ids(input)
  const data = await invoke(input, 'get_gradebook_for_member_v1', { p_actor_id: actorId, p_classroom_id: classroomId, p_view: input.view, p_deadline: '' }, input.view === 'grades' ? contextualGradebookMemberGradesEnvelopeSchema : contextualGradebookMemberItemsEnvelopeSchema)
  checkClassroom(data, actorId, classroomId, false)
  if (data.operation !== 'member-' + input.view || data.source.student_id !== actorId) throw unavailable()
  const source = data.source, visibility = source.visibility
  if (input.view === 'grades' ? !visibility.student_grades || (!visibility.classwork && !visibility.tests) : !visibility.classwork) throw unavailable()
  checkSource(source, classroomId, new Set([actorId]))
  if ((!visibility.classwork && (source.assignments.length || source.assignment_docs.length || source.items.length || source.item_scores.length))
    || ((!visibility.tests || input.view === 'items') && (source.tests.length || source.test_questions.length || source.test_responses.length || source.test_attempts.length))
    || (input.view === 'items' && (source.assignments.length || source.assignment_docs.length || source.score_overrides.length))) throw unavailable()
  const returnedAssignments = new Set(source.assignment_docs.filter(row => row.returned_at !== null).map(row => row.assignment_id))
  const returnedTests = new Set(source.test_attempts.filter(row => row.returned_at !== null).map(row => row.test_id))
  if (source.assignments.some(row => row.is_draft || !returnedAssignments.has(row.id)) || source.assignment_docs.some(row => row.returned_at === null)
    || source.tests.some(row => row.status === 'draft' || !returnedTests.has(row.id)) || source.test_attempts.some(row => row.returned_at === null)
    || source.score_overrides.some(row => row.assessment_type === 'final' || !(row.assessment_type === 'assignment' ? returnedAssignments : returnedTests).has(row.assessment_id))
    || source.items.some(row => !source.item_scores.some(score => score.item_id === row.id))) throw unavailable()
  return complete(input.view === 'grades' ? projectMemberGrades(source, classroomId) : projectMemberGradebookItems(source), input)
}

export async function mutateContextualGradebook(input: Context & { action: GradebookMutationAction; payload: unknown }) {
  input = { ...input, deadline: Math.min(input.deadline ?? Infinity, Date.now() + GRADEBOOK_LIMITS.lifetimeMs) }
  const { actorId, classroomId } = ids(input)
  if (!boundedJson(input.payload, GRADEBOOK_LIMITS.payloadBytes)) throw new ApiError(400, 'Invalid Gradebook payload')
  // UUID normalization belongs only to the admitted contract.
  const normalize = (value: unknown, key = ''): unknown => typeof value === 'string' && (key === 'id' || key.endsWith('_id')) && z.uuid().safeParse(value).success ? value.toLowerCase()
    : Array.isArray(value) ? value.map(child => normalize(child)) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([field, child]) => [field, normalize(child, field)])) : value
  const command = contextualGradebookMutationPayloadSchema.parse({ action: input.action, payload: normalize(input.payload) })
  if (command.action === 'maximum' && command.payload.mode !== 'reset' && !isGradebookMaximumEditingEnabled()) throw new ApiError(409, 'Maximum edits are not enabled on this deployment')
  const data = await invoke(input, 'mutate_gradebook_for_owner_v1', { p_actor_id: actorId, p_classroom_id: classroomId, p_action: command.action, p_payload: command.payload, p_deadline: '' }, contextualGradebookMutationEnvelopeSchema)
  checkClassroom(data, actorId, classroomId, true, true)
  if (data.operation !== command.action) throw unavailable()
  const expectedTarget = command.action === 'categories_replace' ? { category_ids: command.payload.categories.map(row => row.id) }
    : command.action === 'override_delete_all' ? {}
    : 'item_id' in command.payload ? { item_id: command.payload.item_id, ...('student_id' in command.payload ? { student_id: command.payload.student_id } : {}) }
    : { assessment_type: command.payload.assessment_type, assessment_id: command.payload.assessment_id, ...('student_id' in command.payload ? { student_id: command.payload.student_id } : {}) }
  if (!isDeepStrictEqual(data.target, expectedTarget)) throw unavailable()
  if ('assessment' in data.result) {
    if (!('assessment_id' in command.payload) || data.result.assessment.assessment_id !== command.payload.assessment_id || data.result.assessment.assessment_type !== command.payload.assessment_type
      || !('gradebook_weight' in command.payload) || data.result.assessment.weight !== command.payload.gradebook_weight
      || ('category_id' in data.result.assessment && (!('gradebook_category_id' in command.payload) || data.result.assessment.category_id !== command.payload.gradebook_category_id))) throw unavailable()
  }
  if ('item' in data.result) {
    if (!('item_id' in command.payload) || data.result.item.id !== command.payload.item_id || data.result.item.classroom_id !== classroomId) throw unavailable()
    for (const key of ['title', 'points_possible', 'gradebook_category_id', 'gradebook_weight', 'include_in_final'] as const) {
      if (key in command.payload && data.result.item[key] !== command.payload[key as keyof typeof command.payload]) throw unavailable()
    }
  }
  if ('categories' in data.result) {
    if (command.action !== 'categories_replace' || data.result.categories.length !== command.payload.categories.length) throw unavailable()
    for (const row of data.result.categories) {
      const submitted = command.payload.categories.find(category => category.id === row.id)
      if (!submitted || row.classroom_id !== classroomId || Object.entries(submitted).some(([key, value]) => row[key as keyof typeof row] !== value)) throw unavailable()
    }
    unique(data.result.categories, row => row.id)
    return complete({ categories: data.result.categories.map(({ classroom_id: _classroom, ...row }) => row) }, input)
  }
  return complete(data.result, input)
}

export async function patchContextualGradebook(actorId: string, command: GradebookPatchCommand, signal?: AbortSignal) {
  if (command.kind === 'legacy_category_settings') {
    const context = { actorId, classroomId: command.classroomId, signal }, bound = ids(context)
    const data = await invoke(context, 'get_gradebook_for_owner_v1', { p_actor_id: bound.actorId, p_classroom_id: bound.classroomId, p_selected_student_id: null, p_deadline: '' }, contextualGradebookOwnerEnvelopeSchema)
    checkClassroom(data, bound.actorId, bound.classroomId, true)
    if (data.classroom.archived_at !== null) throw new ApiError(403, 'Classroom is archived')
    throw new ApiError(410, 'Category gradebook weights are retired; update assessment weights instead')
  }
  return mutateContextualGradebook({ actorId, classroomId: command.classroomId, signal, action: command.kind, payload: {
    assessment_type: command.assessmentType, assessment_id: command.assessmentId, gradebook_weight: command.gradebookWeight,
    ...(command.kind === 'assessment_details' ? { gradebook_category_id: command.gradebookCategoryId } : {}),
  } })
}
export function replaceContextualGradebookCategories(actorId: string, command: GradebookCategoriesPutCommand, signal?: AbortSignal) {
  return mutateContextualGradebook({ actorId, classroomId: command.classroomId, signal, action: 'categories_replace', payload: {
    categories: command.categories.map(row => ({ id: row.id, name: row.name, percentage: row.percentage, default_assessment_weight: row.defaultAssessmentWeight, position: row.position, is_default: row.isDefault })),
  } })
}
export function saveContextualGradebookOverride(actorId: string, command: GradebookScoreOverridePutCommand, signal?: AbortSignal) {
  const { classroom_id, ...payload } = command
  return mutateContextualGradebook({ actorId, classroomId: classroom_id, signal, action: 'override_save', payload })
}
export function deleteContextualGradebookOverride(actorId: string, command: GradebookScoreOverrideDeleteCommand, signal?: AbortSignal) {
  const { classroom_id, scope, ...payload } = command
  return mutateContextualGradebook({ actorId, classroomId: classroom_id, signal, action: scope === 'one' ? 'override_delete_one' : 'override_delete_all', payload })
}
export function mutateContextualGradebookItem(actorId: string, command: GradebookItemMutation, signal?: AbortSignal) {
  const { classroom_id, action, ...payload } = command
  return mutateContextualGradebook({ actorId, classroomId: classroom_id, signal, action: `item_${action}`, payload })
}
export function scoreContextualGradebookItem(actorId: string, command: GradebookItemScore, signal?: AbortSignal) {
  const { classroom_id, ...payload } = command
  return mutateContextualGradebook({ actorId, classroomId: classroom_id, signal, action: 'item_score', payload })
}
export function maximumContextualGradebook(actorId: string, command: GradebookMaximumPut, signal?: AbortSignal) {
  const { classroom_id, ...payload } = command
  return mutateContextualGradebook({ actorId, classroomId: classroom_id, signal, action: 'maximum', payload })
}
