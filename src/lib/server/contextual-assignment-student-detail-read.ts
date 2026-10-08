import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import type { getServiceRoleClient } from '@/lib/supabase'
import { calculateAssignmentStatus } from '@/lib/assignments'
import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { parseContentField } from '@/lib/tiptap-content'
import { submissionArtifactsToAssignmentArtifacts } from '@/lib/assignment-submission-requirements'
import { extractRepoArtifactsFromContent, resolveAssignmentRepoTarget } from '@/lib/server/assignment-repo-targets'
import { ASSIGNMENT_LIST_BATCH_SIZE, ASSIGNMENT_LIST_COLLECTION_LIMIT, ASSIGNMENT_LIST_DEADLINE_MS, ASSIGNMENT_LIST_DTO_BYTES, ASSIGNMENT_LIST_PAGE_SIZE, ASSIGNMENT_LIST_STATEMENT_LIMIT, boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import { contextualAssignmentOverviewControlSchema, contextualAssignmentOverviewEnvelopeSchema } from '@/lib/validations/contextual-assignment-overview-read'
import {
  contextualAssignmentStudentDetailIdentitySchema, contextualAssignmentStudentDetailControlSchema, contextualAssignmentStudentDetailEnrollmentSchema,
  contextualAssignmentStudentDetailAssignmentSchema, contextualAssignmentStudentDetailStudentSchema, contextualAssignmentStudentDetailDocIdentitySchema,
  contextualAssignmentStudentDetailDocSchema, contextualAssignmentStudentDetailFeedbackSchema, contextualAssignmentStudentDetailTargetSchema,
  contextualAssignmentStudentDetailReviewSchema, contextualAssignmentStudentDetailRequirementSchema, contextualAssignmentStudentDetailArtifactSchema,
} from '@/lib/validations/contextual-assignment-student-detail-read'
import type { AssignmentDoc } from '@/types'
import type { AssignmentArtifact } from '@/lib/assignment-artifacts'

type Client = ReturnType<typeof getServiceRoleClient>
const unavailable = () => new ApiError(503, 'Unable to verify assignment student detail')
const classroomRelation = 'classrooms!assignments_classroom_id_fkey!inner'
const classroomFields = 'id,teacher_id,archived_at'
const targetRelation = 'target:classroom_enrollments!classroom_enrollments_classroom_id_fkey'
const enrollmentFields = 'id,classroom_id,student_id'
const ownerFields = `id,classroom_id,${classroomRelation}(${classroomFields})`
const targetFields = `${classroomFields},${targetRelation}!inner(${enrollmentFields})`
const controlFields = `id,classroom_id,${classroomRelation}(${targetFields})`
const docRelation = 'docs:assignment_docs!assignment_docs_assignment_id_fkey'
const artifactRelation = 'artifacts:assignment_submission_artifacts!assignment_submission_artifacts_assignment_doc_id_fkey'
const fields = (schema: z.ZodObject) => Object.keys(schema.shape).join(',')
const artifactFields = `${fields(contextualAssignmentStudentDetailArtifactSchema.omit({ requirement: true, managed_object: true }))},requirement:assignment_submission_requirements!assignment_submission_artifacts_requirement_id_fkey!inner(id,assignment_id,type),managed_object:managed_storage_objects!assignment_submission_artifacts_managed_object_id_fkey(id,classroom_id,data_subject_user_id,resource_type,resource_id,purpose,status,storage_bucket,storage_path)`

/** Every statement proves current owner and exact nonowner target membership. This is not an atomic snapshot. */
export async function readContextualAssignmentStudentDetail(input: { supabase: Client; actorId: string; assignmentId: string; studentId: string }) {
  const identity = contextualAssignmentStudentDetailIdentitySchema.safeParse({ actorId: input.actorId, assignmentId: input.assignmentId, studentId: input.studentId })
  if (!identity.success) throw new ApiError(400, 'Invalid assignment student detail query')
  const { actorId, assignmentId, studentId } = identity.data
  const controller = new AbortController(); const deadline = Date.now() + ASSIGNMENT_LIST_DEADLINE_MS
  const timer = setTimeout(() => controller.abort(), ASSIGNMENT_LIST_DEADLINE_MS)
  let statements = 0
  const checkDeadline = () => { if (controller.signal.aborted || Date.now() >= deadline) throw unavailable() }
  async function execute(query: PromiseLike<unknown> | (() => PromiseLike<unknown>), storage = false) {
    checkDeadline(); if (++statements > ASSIGNMENT_LIST_STATEMENT_LIMIT) throw unavailable()
    // Storage calls return hot promises: invoke them only after both guards.
    const pending = typeof query === 'function' ? query() : query
    const result = await new Promise<unknown>((resolve, reject) => {
      const abort = () => reject(unavailable())
      controller.signal.addEventListener('abort', abort, { once: true })
      Promise.resolve(pending).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort))
    })
    checkDeadline()
    // Storage SDK errors are Error instances. Only a null-data failure envelope
    // may retain the old URL; malformed successful signing evidence fails closed.
    if (storage && result && typeof result === 'object' && Object.keys(result).length === 2 && 'error' in result && 'data' in result && result.data === null && result.error instanceof Error
      && ['StorageApiError', 'StorageUnknownError'].includes(result.error.name)) {
      if ('originalError' in result.error && result.error.originalError instanceof SyntaxError) throw unavailable()
      return { data: null, error: true }
    }
    if (!boundedAssignmentListJson(result, ASSIGNMENT_LIST_DTO_BYTES)) throw unavailable()
    return result
  }
  async function envelope<T extends z.ZodType>(query: PromiseLike<unknown>, schema: T): Promise<z.infer<T> | null> {
    const decoded = contextualAssignmentOverviewEnvelopeSchema(schema).safeParse(await execute(query))
    if (!decoded.success) throw unavailable()
    return (decoded.data as unknown as { data: z.infer<T> | null }).data
  }
  try {
    const control = await envelope(input.supabase.from('assignments').select(ownerFields).eq('id', assignmentId).abortSignal(controller.signal).maybeSingle(), contextualAssignmentOverviewControlSchema)
    if (!control) throw new ApiError(404, 'Assignment not found')
    if (control.id !== assignmentId || control.classrooms.id !== control.classroom_id) throw unavailable()
    if (control.classrooms.teacher_id !== actorId || studentId === actorId) throw new ApiError(403, 'Forbidden')
    const classroomId = control.classroom_id
    function queryFor(select = controlFields) {
      return input.supabase.from('assignments').select(select).eq('id', assignmentId).eq('classroom_id', classroomId)
        .eq('classrooms.id', classroomId).eq('classrooms.teacher_id', actorId)
        .eq('classrooms.target.classroom_id', classroomId).eq('classrooms.target.student_id', studentId).neq('classrooms.target.student_id', actorId)
        .limit(2, { referencedTable: 'classrooms.target' }).abortSignal(controller.signal)
    }
    function assertRoot(row: z.infer<typeof contextualAssignmentOverviewControlSchema>) {
      if (row.id !== assignmentId || row.classroom_id !== classroomId || row.classrooms.id !== classroomId || row.classrooms.teacher_id !== actorId) throw unavailable()
    }
    function assertEnrollment(row: z.infer<typeof contextualAssignmentStudentDetailEnrollmentSchema>) {
      if (row.classroom_id !== classroomId || row.student_id !== studentId || row.student_id === actorId) throw unavailable()
    }
    const targetPreflightSchema = contextualAssignmentOverviewControlSchema.extend({ classrooms: contextualAssignmentOverviewControlSchema.shape.classrooms.extend({ target: z.array(contextualAssignmentStudentDetailEnrollmentSchema).max(1) }).strict() }).strict()
    const targetControl = await envelope(queryFor(`id,classroom_id,${classroomRelation}(${classroomFields},${targetRelation}(${enrollmentFields}))`).maybeSingle(), targetPreflightSchema)
    if (!targetControl) throw unavailable()
    assertRoot(targetControl)
    if (!targetControl.classrooms.target.length) throw new ApiError(404, 'Student not found in classroom')
    assertEnrollment(targetControl.classrooms.target[0])
    async function decode<T extends z.ZodType>(query: PromiseLike<unknown>, schema: T): Promise<z.infer<T>> {
      const row = await envelope(query, schema)
      if (!row) throw unavailable()
      const root = contextualAssignmentStudentDetailControlSchema.safeParse(row && typeof row === 'object' ? {
        id: (row as any).id, classroom_id: (row as any).classroom_id,
        classrooms: { id: (row as any).classrooms?.id, teacher_id: (row as any).classrooms?.teacher_id, archived_at: (row as any).classrooms?.archived_at,
          target: (row as any).classrooms?.target?.map((target: any) => ({ id: target.id, classroom_id: target.classroom_id, student_id: target.student_id })) },
      } : null)
      if (!root.success) throw unavailable()
      assertRoot(root.data); assertEnrollment(root.data.classrooms.target[0]); return row
    }
    const assignment = await decode(queryFor(`${fields(contextualAssignmentStudentDetailAssignmentSchema.omit({ classrooms: true }))},${classroomRelation}(${targetFields},title)`).maybeSingle(), contextualAssignmentStudentDetailAssignmentSchema)
    const studentRoot = await decode(queryFor(`id,classroom_id,${classroomRelation}(${classroomFields},${targetRelation}!inner(${enrollmentFields},users!classroom_enrollments_student_id_fkey!inner(id,email,profiles:student_profiles!student_profiles_user_id_fkey(user_id,first_name,last_name))))`)
      .limit(2, { referencedTable: 'classrooms.target.users.profiles' }).maybeSingle(), contextualAssignmentStudentDetailStudentSchema)
    const user = studentRoot.classrooms.target[0].users; const profile = user.profiles
    if (user.id !== studentId || (profile && profile.user_id !== studentId)) throw unavailable()
    function assertPair(row: { assignment_id: string; student_id: string }) { if (row.assignment_id !== assignmentId || row.student_id !== studentId) throw unavailable() }
    async function singleton<T extends z.ZodType<{ assignment_id: string; student_id: string }>>(kind: 'docs' | 'targets', relation: string, schema: T) {
      const root = await decode(queryFor(`${controlFields},${kind}:${relation}(${fields(schema as unknown as z.ZodObject)})`)
        .eq(`${kind}.assignment_id`, assignmentId).eq(`${kind}.student_id`, studentId).limit(2, { referencedTable: kind }).maybeSingle(), contextualAssignmentStudentDetailControlSchema.extend({ [kind]: z.array(schema).max(1) }).strict())
      const rows = (root as unknown as Record<string, z.infer<T>[]>)[kind]
      if (rows[0]) assertPair(rows[0]); return rows[0] ?? null
    }
    const docRow = await singleton('docs', 'assignment_docs!assignment_docs_assignment_id_fkey', contextualAssignmentStudentDetailDocSchema)
    const target = await singleton('targets', 'assignment_repo_targets!assignment_repo_targets_assignment_id_fkey', contextualAssignmentStudentDetailTargetSchema)
    const totals = new Map<string, number>()
    async function collection<T extends z.ZodType<{ id: string }>>(kind: 'requirements' | 'feedback', relation: string, schema: T) {
      const rows: z.infer<T>[] = []; const seen = new Set<string>(); let cursor: string | undefined
      for (;;) {
        let query = queryFor(`${controlFields},${kind}:${relation}(${fields(schema as unknown as z.ZodObject)})`).eq(`${kind}.assignment_id`, assignmentId)
        if (kind === 'feedback') query = query.eq('feedback.student_id', studentId)
        if (cursor) query = query.gt(`${kind}.id`, cursor)
        const root = await decode(query.order('id', { ascending: true, referencedTable: kind }).limit(ASSIGNMENT_LIST_PAGE_SIZE, { referencedTable: kind }).maybeSingle(), contextualAssignmentStudentDetailControlSchema.extend({ [kind]: z.array(schema).max(ASSIGNMENT_LIST_PAGE_SIZE) }).strict())
        const page = (root as unknown as Record<string, z.infer<T>[]>)[kind]
        if (!page.length) return rows
        for (const child of page) {
          if (seen.has(child.id) || (cursor && child.id <= cursor)) throw unavailable()
          add(kind); seen.add(child.id); rows.push(child); cursor = child.id
        }
      }
    }
    function add(kind: string) { const total = (totals.get(kind) ?? 0) + 1; if (total > ASSIGNMENT_LIST_COLLECTION_LIMIT) throw unavailable(); totals.set(kind, total) }
    const requirements = await collection('requirements', 'assignment_submission_requirements!assignment_submission_requirements_assignment_id_fkey', contextualAssignmentStudentDetailRequirementSchema)
    for (const row of requirements) if (row.assignment_id !== assignmentId) throw unavailable()
    requirements.sort((a, b) => a.position - b.position || Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
    const feedback = await collection('feedback', 'assignment_feedback_entries!assignment_feedback_entries_assignment_id_fkey', contextualAssignmentStudentDetailFeedbackSchema)
    for (const row of feedback) assertPair(row)
    feedback.sort((a, b) => Date.parse(a.returned_at) - Date.parse(b.returned_at) || Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
    const reviewRoot = await decode(queryFor(`${controlFields},reviews:assignment_repo_review_results!assignment_repo_review_results_assignment_id_fkey(${fields(contextualAssignmentStudentDetailReviewSchema.omit({ run: true }))},run:assignment_repo_review_runs!assignment_repo_review_results_run_id_fkey!inner(id,assignment_id,status))`)
      .eq('reviews.assignment_id', assignmentId).eq('reviews.student_id', studentId).eq('reviews.run.assignment_id', assignmentId).eq('reviews.run.status', 'completed')
      .order('created_at', { ascending: false, referencedTable: 'reviews' }).order('id', { ascending: false, referencedTable: 'reviews' }).limit(1, { referencedTable: 'reviews' }).maybeSingle(),
    contextualAssignmentStudentDetailControlSchema.extend({ reviews: z.array(contextualAssignmentStudentDetailReviewSchema).max(1) }).strict())
    const latest = reviewRoot.reviews[0] ?? null
    if (latest) { assertPair(latest); if (latest.run.id !== latest.run_id || latest.run.assignment_id !== assignmentId) throw unavailable() }
    const requirementMap = new Map(requirements.map(r => [r.id, r]))
    type Artifact = z.infer<typeof contextualAssignmentStudentDetailArtifactSchema>
    const artifacts: Artifact[] = []
    function assertDoc(row: z.infer<typeof contextualAssignmentStudentDetailDocIdentitySchema>) { assertPair(row); if (!docRow || row.id !== docRow.id) throw unavailable() }
    function artifactQuery() {
      if (!docRow) throw unavailable()
      return queryFor(`${controlFields},${docRelation}!inner(${fields(contextualAssignmentStudentDetailDocIdentitySchema)},${artifactRelation}(${artifactFields}))`)
        .eq('docs.id', docRow.id).eq('docs.assignment_id', assignmentId).eq('docs.student_id', studentId).limit(2, { referencedTable: 'docs' })
        .eq('docs.artifacts.student_id', studentId).eq('docs.artifacts.requirement.assignment_id', assignmentId)
    }
    const artifactRootSchema = contextualAssignmentStudentDetailControlSchema.extend({ docs: z.array(contextualAssignmentStudentDetailDocIdentitySchema.extend({ artifacts: z.array(contextualAssignmentStudentDetailArtifactSchema).max(ASSIGNMENT_LIST_PAGE_SIZE) }).strict()).length(1) }).strict()
    function assertArtifact(artifact: Artifact) {
      const requirement = requirementMap.get(artifact.requirement_id); const object = artifact.managed_object
      if (!docRow || artifact.assignment_doc_id !== docRow.id || artifact.student_id !== studentId || !requirement
        || artifact.requirement.id !== requirement.id || artifact.requirement.assignment_id !== assignmentId || artifact.requirement.type !== artifact.type || requirement.type !== artifact.type) throw unavailable()
      if (artifact.managed_object_id === null ? object !== null : !object || object.id !== artifact.managed_object_id || object.classroom_id !== classroomId
        || object.data_subject_user_id !== studentId || object.resource_id !== docRow.id || object.storage_path !== artifact.storage_path) throw unavailable()
      if (artifact.storage_path === null) { if (object || artifact.managed_object_id) throw unavailable(); return }
      if (artifact.type !== 'image') throw unavailable()
      const path = artifact.storage_path
      if (path.includes('\\') || path.split('/').some(segment => segment === '.' || segment === '..')) throw unavailable()
      const legacyPrefix = `${studentId}/${assignmentId}/${requirement.id}-`
      const legacy = path.startsWith(legacyPrefix) && /^\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[\s\S]+$/.test(path.slice(legacyPrefix.length))
      const uploadPrefix = object ? `classrooms/${classroomId}/students/${studentId}/assignment-docs/${docRow.id}/artifacts/${object.id}.` : ''
      const upload = !!object && path.startsWith(uploadPrefix) && path.length > uploadPrefix.length
      const restored = !!object && new RegExp(`^restores/${classroomId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}-[0-9a-f]{64}$`).test(path)
      if (!legacy && !upload && !restored) throw unavailable()
    }
    if (docRow) {
      const seen = new Set<string>(); const pairs = new Set<string>(); let cursor: string | undefined
      for (;;) {
        let query = artifactQuery()
        if (cursor) query = query.gt('docs.artifacts.id', cursor)
        const root = await decode(query.order('id', { ascending: true, referencedTable: 'docs.artifacts' }).limit(ASSIGNMENT_LIST_PAGE_SIZE, { referencedTable: 'docs.artifacts' }).maybeSingle(), artifactRootSchema)
        const parent = root.docs[0]; assertDoc(parent)
        if (!parent.artifacts.length) break
        for (const artifact of parent.artifacts) {
          assertArtifact(artifact)
          if (seen.has(artifact.id) || pairs.has(artifact.requirement_id) || (cursor && artifact.id <= cursor)) throw unavailable()
          add('artifacts'); seen.add(artifact.id); pairs.add(artifact.requirement_id); artifacts.push(artifact); cursor = artifact.id
        }
      }
    }
    const signedArtifacts = artifacts.map(({ requirement: _requirement, managed_object: _object, ...artifact }) => artifact)
    const images = signedArtifacts.filter(a => a.type === 'image' && a.storage_path)
    for (let start = 0; start < images.length; start += ASSIGNMENT_LIST_BATCH_SIZE) {
      const batch = images.slice(start, start + ASSIGNMENT_LIST_BATCH_SIZE); const expected = new Map(batch.map(a => [a.id, a]))
      const root = await decode(artifactQuery().in('docs.artifacts.id', batch.map(a => a.id)).limit(ASSIGNMENT_LIST_BATCH_SIZE, { referencedTable: 'docs.artifacts' }).maybeSingle(), artifactRootSchema)
      const parent = root.docs[0]; assertDoc(parent); const proven = new Set<string>()
      for (const artifact of parent.artifacts) {
        assertArtifact(artifact); const base = expected.get(artifact.id)
        if (!base || proven.has(artifact.id) || artifact.assignment_doc_id !== parent.id || artifact.requirement_id !== base.requirement_id
          || artifact.storage_path !== base.storage_path || artifact.managed_object_id !== base.managed_object_id) throw unavailable()
        proven.add(artifact.id)
      }
      if (proven.size !== batch.length) throw unavailable()
      const response = await execute(() => input.supabase.storage.from('assignment-artifacts').createSignedUrls(batch.map(a => a.storage_path!), 3600), true)
      const signed = z.union([
        z.object({ data: z.array(z.object({ path: z.string(), signedURL: z.string().nullable(), signedUrl: z.string().nullable(), error: z.string().nullable() }).strict()), error: z.null() }).strict(),
        z.object({ data: z.null(), error: z.literal(true) }).strict(),
      ]).safeParse(response)
      if (!signed.success) throw unavailable()
      if (signed.data.error) continue
      const byPath = new Map(batch.map(a => [a.storage_path!, a])); const returned = new Set<string>()
      for (const row of signed.data.data) {
        if (!byPath.has(row.path) || returned.has(row.path)) throw unavailable()
        returned.add(row.path)
        if (row.error) continue
        if (!row.signedUrl || !row.signedURL) throw unavailable()
        const expectedUrl = new URL(input.supabase.storage.from('assignment-artifacts').getPublicUrl(row.path).data.publicUrl)
        const url = new URL(row.signedUrl)
        if (url.origin !== expectedUrl.origin || url.pathname !== expectedUrl.pathname.replace('/object/public/', '/object/sign/') || url.username || url.password || url.hash
          || url.searchParams.size !== 1 || !url.searchParams.get('token')) throw unavailable()
        for (const artifact of batch) if (artifact.storage_path === row.path) artifact.url = row.signedUrl
      }
      if (returned.size !== byPath.size) throw unavailable()
    }
    await decode(queryFor().maybeSingle(), contextualAssignmentStudentDetailControlSchema)
    const doc = docRow ? { ...docRow, content: parseContentField(docRow.content) } : null
    if (doc && !boundedAssignmentListJson(doc.content, 2 * 1024 * 1024)) throw unavailable()
    const structuredRepos = submissionArtifactsToAssignmentArtifacts(signedArtifacts, requirements).filter(a => a.type === 'repo')
    // Match NextResponse's omission of optional undefined helper fields before
    // applying the strict JSON bound to the complete wire DTO.
    const candidateRepos = (structuredRepos.length ? structuredRepos : extractRepoArtifactsFromContent(doc?.content))
      .map(artifact => Object.fromEntries(Object.entries(artifact).filter(([, value]) => value !== undefined)) as AssignmentArtifact)
    const selection = resolveAssignmentRepoTarget({ candidateRepos,
      submittedRepoUrl: doc?.repo_url ?? null, submittedGitHubUsername: doc?.github_username ?? null, target })
    const latestResult = latest ? (({ run: _run, ...row }) => row)(latest) : null
    const result = { assignment: { id: assignment.id, classroom_id: classroomId, title: assignment.title, description: assignment.description,
      instructions_markdown: getAssignmentInstructionsMarkdown(assignment).markdown, due_at: assignment.due_at, position: assignment.position,
      submission_requirements: requirements, created_by: assignment.created_by, created_at: assignment.created_at, updated_at: assignment.updated_at },
    classroom: { id: classroomId, teacher_id: actorId, title: assignment.classrooms.title }, student: { id: studentId, email: user.email, name: profile ? `${profile.first_name} ${profile.last_name}` : null },
    doc, submission_artifacts: signedArtifacts, status: calculateAssignmentStatus(assignment as unknown as Parameters<typeof calculateAssignmentStatus>[0], doc as unknown as AssignmentDoc), feedback_entries: feedback, repo_target: { ...selection, latest_result: latestResult } }
    if (!boundedAssignmentListJson(result, ASSIGNMENT_LIST_DTO_BYTES)) throw unavailable()
    checkDeadline()
    return result
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw unavailable()
  } finally { clearTimeout(timer) }
}
