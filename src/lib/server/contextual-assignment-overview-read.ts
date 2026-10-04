import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import type { getServiceRoleClient } from '@/lib/supabase'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { calculateAssignmentStatus } from '@/lib/assignments'
import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { extractAssignmentArtifacts } from '@/lib/assignment-artifacts'
import { getSubmissionRequirementCompletion, submissionArtifactsToAssignmentArtifacts } from '@/lib/assignment-submission-requirements'
import { toAssignmentAiGradingRunSummary } from '@/lib/server/assignment-ai-grading-runs'
import {
  ASSIGNMENT_LIST_BATCH_SIZE, ASSIGNMENT_LIST_CHILD_PAGE_SIZE, ASSIGNMENT_LIST_COLLECTION_LIMIT, ASSIGNMENT_LIST_DEADLINE_MS,
  ASSIGNMENT_LIST_DTO_BYTES, ASSIGNMENT_LIST_PAGE_SIZE, ASSIGNMENT_LIST_STATEMENT_LIMIT,
  boundedAssignmentListJson, contextualAssignmentListRequirementSchema,
} from '@/lib/validations/contextual-assignment-list-read'
import {
  contextualAssignmentOverviewIdentitySchema, contextualAssignmentOverviewControlSchema, contextualAssignmentOverviewAssignmentSchema,
  contextualAssignmentOverviewEnrollmentSchema, contextualAssignmentOverviewDocSchema, contextualAssignmentOverviewDocIdentitySchema,
  contextualAssignmentOverviewHistorySchema, contextualAssignmentOverviewArtifactSchema, contextualAssignmentOverviewRunSchema,
  contextualAssignmentOverviewRunItemSchema, contextualAssignmentOverviewEnvelopeSchema,
} from '@/lib/validations/contextual-assignment-overview-read'
import type { AssignmentDoc, AssignmentAiGradingRunItem, AuthenticatedUser } from '@/types'

type Client = ReturnType<typeof getServiceRoleClient>
type DocIdentity = z.infer<typeof contextualAssignmentOverviewDocIdentitySchema>
const unavailable = () => new ApiError(503, 'Unable to verify assignment overview')
const classroomFields = 'id,teacher_id,archived_at'
const classroomRelation = 'classrooms!assignments_classroom_id_fkey!inner'
const controlFields = `id,classroom_id,${classroomRelation}(${classroomFields})`
const assignmentFields = 'id,classroom_id,title,description,due_at,position,created_by,created_at,updated_at,is_draft,released_at,instructions_markdown,rich_instructions,artifact_id,source_artifact_id,source_blueprint_version_id,blueprint_archived_at,points_possible,gradebook_category_id,gradebook_maximum_override,gradebook_score_scale,gradebook_weight,include_in_final,track_authenticity'
const requirementFields = 'id,assignment_id,artifact_id,type,label,instructions,required,position,created_at,updated_at,source_artifact_id,source_blueprint_version_id,validation_policy_json'
const participantFields = 'participant:users!assignment_docs_student_id_fkey!inner(id,enrollment:classroom_enrollments!classroom_enrollments_student_id_fkey!inner(classroom_id,student_id))'
const docIdentityFields = `id,assignment_id,student_id,${participantFields}`
const docFields = `${docIdentityFields},content,is_submitted,submitted_at,updated_at,score_completion,score_thinking,score_workflow,graded_at,returned_at,teacher_cleared_at,feedback_returned_at`
const artifactFields = 'id,assignment_doc_id,requirement_id,student_id,type,url,storage_path,managed_object_id,metadata_json,validation_status,validation_message,validated_at,created_at,updated_at,requirement:assignment_submission_requirements!assignment_submission_artifacts_requirement_id_fkey!inner(id,assignment_id,type),managed_object:managed_storage_objects!assignment_submission_artifacts_managed_object_id_fkey(id,classroom_id,data_subject_user_id,resource_type,resource_id,purpose,status,storage_bucket,storage_path)'
const runFields = 'id,assignment_id,status,model,requested_count,gradable_count,processed_count,completed_count,skipped_missing_count,skipped_empty_count,failed_count,error_samples_json,started_at,completed_at,created_at'
const runItemFields = 'id,run_id,assignment_id,student_id,status,next_retry_at'

export async function authorizeSharedAssignmentOverviewReadActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' }
  const user = await requireAuth()
  return resolveClassroomExperienceAdmission(user).status === 'admitted' ? { mode: 'shared', user } : { mode: 'existing' }
}

/** Owner authority is proved by every payload statement, including empty terminal and final reads. */
export async function readContextualAssignmentOverview(input: { supabase: Client; actorId: string; assignmentId: string }) {
  const identity = contextualAssignmentOverviewIdentitySchema.safeParse({ actorId: input.actorId, assignmentId: input.assignmentId })
  if (!identity.success) throw new ApiError(400, 'Invalid assignment overview query')
  const { actorId, assignmentId } = identity.data
  const controller = new AbortController(); const deadline = Date.now() + ASSIGNMENT_LIST_DEADLINE_MS
  const timer = setTimeout(() => controller.abort(), ASSIGNMENT_LIST_DEADLINE_MS)
  let statements = 0
  const checkDeadline = () => { if (controller.signal.aborted || Date.now() >= deadline) throw unavailable() }
  async function execute(query: PromiseLike<unknown>) {
    checkDeadline()
    if (++statements > ASSIGNMENT_LIST_STATEMENT_LIMIT) throw unavailable()
    const result = await new Promise<unknown>((resolve, reject) => {
      const abort = () => reject(unavailable())
      controller.signal.addEventListener('abort', abort, { once: true })
      Promise.resolve(query).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort))
    })
    checkDeadline()
    if (!boundedAssignmentListJson(result, ASSIGNMENT_LIST_DTO_BYTES)) throw unavailable()
    return result
  }
  try {
    const preflight = contextualAssignmentOverviewEnvelopeSchema(contextualAssignmentOverviewControlSchema).safeParse(await execute(input.supabase.from('assignments')
      .select(controlFields).eq('id', assignmentId).abortSignal(controller.signal).maybeSingle()))
    if (!preflight.success) throw unavailable()
    const control = preflight.data.data
    if (control === null) throw new ApiError(404, 'Assignment not found')
    if (control.id !== assignmentId || control.classrooms.id !== control.classroom_id) throw unavailable()
    if (control.classrooms.teacher_id !== actorId) throw new ApiError(403, 'Forbidden')
    const classroomId = control.classroom_id
    function queryFor(select = controlFields) {
      return input.supabase.from('assignments').select(select).eq('id', assignmentId).eq('classroom_id', classroomId)
        .eq('classrooms.id', classroomId).eq('classrooms.teacher_id', actorId).abortSignal(controller.signal)
    }
    async function decode<T extends z.ZodType>(query: PromiseLike<unknown>, schema: T): Promise<z.infer<T>> {
      const result = contextualAssignmentOverviewEnvelopeSchema(schema).safeParse(await execute(query))
      if (!result.success) throw unavailable()
      const row = (result.data as unknown as { data: z.infer<T> | null }).data
      if (row === null) throw new ApiError(403, 'Forbidden')
      const root = contextualAssignmentOverviewControlSchema.safeParse({ id: (row as any).id, classroom_id: (row as any).classroom_id,
        classrooms: { id: (row as any).classrooms?.id, teacher_id: (row as any).classrooms?.teacher_id, archived_at: (row as any).classrooms?.archived_at } })
      if (!root.success || root.data.id !== assignmentId || root.data.classroom_id !== classroomId || root.data.classrooms.id !== classroomId || root.data.classrooms.teacher_id !== actorId) throw unavailable()
      return row
    }
    const assignment = await decode(queryFor(`${assignmentFields},${classroomRelation}(${classroomFields},title)`).maybeSingle(), contextualAssignmentOverviewAssignmentSchema)
    const totals = new Map<string, number>()
    function add(kind: string) { const total = (totals.get(kind) ?? 0) + 1; if (total > ASSIGNMENT_LIST_COLLECTION_LIMIT) throw unavailable(); totals.set(kind, total) }
    async function collection<T extends z.ZodType<{ id: string }>>(kind: 'enrollments' | 'docs' | 'requirements', fields: string, schema: T) {
      const rows: z.infer<T>[] = []; const seen = new Set<string>(); let cursor: string | undefined
      const reference = kind === 'enrollments' ? 'classrooms.enrollments' : kind
      const pageSchema = kind === 'enrollments' ? contextualAssignmentOverviewControlSchema.extend({ classrooms: contextualAssignmentOverviewControlSchema.shape.classrooms.extend({ enrollments: z.array(schema).max(ASSIGNMENT_LIST_PAGE_SIZE) }).strict() }).strict()
        : contextualAssignmentOverviewControlSchema.extend({ [kind]: z.array(schema).max(ASSIGNMENT_LIST_PAGE_SIZE) }).strict()
      for (;;) {
        const relation = kind === 'docs' ? 'assignment_docs!assignment_docs_assignment_id_fkey' : 'assignment_submission_requirements!assignment_submission_requirements_assignment_id_fkey'
        const select = kind === 'enrollments' ? `id,classroom_id,${classroomRelation}(${classroomFields},enrollments:classroom_enrollments!classroom_enrollments_classroom_id_fkey(${fields}))`
          : `${controlFields},${kind}:${relation}(${fields})`
        let query = queryFor(select)
        if (cursor) query = query.gt(`${reference}.id`, cursor)
        if (kind === 'enrollments') query = query.neq(`${reference}.student_id`, actorId).eq(`${reference}.classroom_id`, classroomId)
          .limit(2, { referencedTable: `${reference}.users.profiles` })
        if (kind === 'docs') query = query.neq('docs.student_id', actorId).eq('docs.participant.enrollment.classroom_id', classroomId)
        const root = await decode(query.order('id', { ascending: true, referencedTable: reference }).limit(ASSIGNMENT_LIST_PAGE_SIZE, { referencedTable: reference }).maybeSingle(), pageSchema)
        const children = (kind === 'enrollments' ? (root as any).classrooms.enrollments : (root as any)[kind]) as z.infer<T>[]
        if (!children.length) return rows
        for (const child of children) {
          if (seen.has(child.id) || (cursor && child.id <= cursor)) throw unavailable()
          add(kind); seen.add(child.id); rows.push(child); cursor = child.id
        }
      }
    }
    const enrollments = await collection('enrollments', 'id,classroom_id,student_id,users!classroom_enrollments_student_id_fkey!inner(id,email,profiles:student_profiles!student_profiles_user_id_fkey(user_id,first_name,last_name))', contextualAssignmentOverviewEnrollmentSchema)
    const roster = new Set<string>()
    for (const e of enrollments) {
      if (e.classroom_id !== classroomId || e.student_id === actorId || e.users.id !== e.student_id || roster.has(e.student_id)
        || (e.users.profiles && e.users.profiles.user_id !== e.student_id)) throw unavailable()
      roster.add(e.student_id)
    }
    const requirements = await collection('requirements', requirementFields, contextualAssignmentListRequirementSchema)
    for (const requirement of requirements) if (requirement.assignment_id !== assignmentId) throw unavailable()
    requirements.sort((a, b) => a.position - b.position || Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
    const docs = await collection('docs', docFields, contextualAssignmentOverviewDocSchema)
    const docByStudent = new Map<string, typeof docs[number]>()
    function assertDoc(doc: DocIdentity) {
      if (doc.assignment_id !== assignmentId || doc.student_id === actorId || !roster.has(doc.student_id) || doc.participant.id !== doc.student_id
        || doc.participant.enrollment.some(e => e.classroom_id !== classroomId || e.student_id !== doc.student_id)) throw unavailable()
    }
    for (const doc of docs) { assertDoc(doc); if (docByStudent.has(doc.student_id)) throw unavailable(); docByStudent.set(doc.student_id, doc) }

    async function docChildren<T extends z.ZodType<{ id: string; assignment_doc_id: string }>>(kind: 'artifacts' | 'history', fields: string, schema: T) {
      const rows: z.infer<T>[] = []; const seen = new Set<string>()
      for (let start = 0; start < docs.length; start += ASSIGNMENT_LIST_BATCH_SIZE) {
        const batch = docs.slice(start, start + ASSIGNMENT_LIST_BATCH_SIZE); const expected = new Map(batch.map(d => [d.id, d])); let cursor: string | undefined
        const parentSchema = contextualAssignmentOverviewDocIdentitySchema.extend({ [kind]: z.array(schema).max(ASSIGNMENT_LIST_CHILD_PAGE_SIZE) }).strict()
        const pageSchema = contextualAssignmentOverviewControlSchema.extend({ docs: z.array(parentSchema).max(ASSIGNMENT_LIST_BATCH_SIZE) }).strict()
        for (;;) {
          const relation = kind === 'artifacts' ? 'assignment_submission_artifacts!assignment_submission_artifacts_assignment_doc_id_fkey' : 'assignment_doc_history!assignment_doc_history_assignment_doc_id_fkey'
          let query = queryFor(`${controlFields},docs:assignment_docs!assignment_docs_assignment_id_fkey(${docIdentityFields},${kind}:${relation}(${fields}))`)
            .in('docs.id', batch.map(d => d.id)).neq('docs.student_id', actorId).eq('docs.participant.enrollment.classroom_id', classroomId)
            .order('id', { ascending: true, referencedTable: 'docs' }).limit(ASSIGNMENT_LIST_BATCH_SIZE, { referencedTable: 'docs' })
          if (kind === 'artifacts') query = query.eq('docs.artifacts.requirement.assignment_id', assignmentId)
          if (cursor) query = query.gt(`docs.${kind}.id`, cursor)
          const root = await decode(query.order('id', { ascending: true, referencedTable: `docs.${kind}` }).limit(ASSIGNMENT_LIST_CHILD_PAGE_SIZE, { referencedTable: `docs.${kind}` }).maybeSingle(), pageSchema)
          if (root.docs.length !== batch.length) throw unavailable()
          const parents = new Set<string>(); const statementIds = new Set<string>(); const candidates: z.infer<T>[] = []; const tails: string[] = []
          for (const parent of root.docs as Array<DocIdentity & Record<string, unknown>>) {
            const base = expected.get(parent.id)
            if (!base || parents.has(parent.id) || base.student_id !== parent.student_id) throw unavailable()
            assertDoc(parent); parents.add(parent.id); let last = cursor
            const children = (parent as any)[kind] as z.infer<T>[]
            for (const child of children) {
              if (child.assignment_doc_id !== parent.id || statementIds.has(child.id) || (last && child.id <= last)) throw unavailable()
              statementIds.add(child.id); last = child.id; candidates.push(child)
            }
            if (children.length) tails.push(last!)
          }
          if (!tails.length) break
          // A common cursor must use the smallest nonempty tail to retain fuller siblings.
          const next = tails.sort()[0]
          if (cursor && next <= cursor) throw unavailable()
          for (const child of candidates) if (child.id <= next) {
            if (seen.has(child.id)) throw unavailable()
            add(kind); seen.add(child.id); rows.push(child)
          }
          cursor = next
        }
      }
      return rows
    }
    const artifacts = await docChildren('artifacts', artifactFields, contextualAssignmentOverviewArtifactSchema)
    const requirementMap = new Map(requirements.map(r => [r.id, r])); const docMap = new Map(docs.map(d => [d.id, d]))
    const artifactPairs = new Set<string>()
    function assertArtifact(artifact: z.infer<typeof contextualAssignmentOverviewArtifactSchema>) {
      const doc = docMap.get(artifact.assignment_doc_id); const requirement = requirementMap.get(artifact.requirement_id)
      if (!doc || artifact.student_id !== doc.student_id || !requirement
        || artifact.requirement.id !== artifact.requirement_id || artifact.requirement.assignment_id !== assignmentId
        || artifact.requirement.type !== artifact.type || requirement.type !== artifact.type) throw unavailable()
      const object = artifact.managed_object
      if (artifact.managed_object_id === null ? object !== null : !object || object.id !== artifact.managed_object_id
        || object.classroom_id !== classroomId || object.data_subject_user_id !== doc.student_id || object.resource_id !== doc.id || object.storage_path !== artifact.storage_path) throw unavailable()
      if (artifact.storage_path !== null) {
        if (artifact.type !== 'image') throw unavailable()
        const path = artifact.storage_path
        if (path.includes('\\') || path.split('/').some(segment => segment === '.' || segment === '..')) throw unavailable()
        const legacyPrefix = `${doc.student_id}/${assignmentId}/${requirement.id}-`
        // Registry backfill preserves legacy names. Upload producers validate MIME/size,
        // not filename extensions; namespace and exact registry scope prove authority.
        const legacy = path.startsWith(legacyPrefix)
          && /^\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[\s\S]+$/.test(path.slice(legacyPrefix.length))
        const uploadPrefix = object ? `classrooms/${classroomId}/students/${doc.student_id}/assignment-docs/${doc.id}/artifacts/${object.id}.` : ''
        const upload = !!object && path.startsWith(uploadPrefix) && path.length > uploadPrefix.length
        const restored = !!object && new RegExp(`^restores/${classroomId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}-[0-9a-f]{64}$`).test(path)
        if (!legacy && !upload && !restored) throw unavailable()
      } else if (object || artifact.managed_object_id) throw unavailable()
    }
    for (const artifact of artifacts) {
      assertArtifact(artifact)
      const pair = `${artifact.assignment_doc_id}:${artifact.requirement_id}`
      if (artifactPairs.has(pair)) throw unavailable()
      artifactPairs.add(pair)
    }
    const history = await docChildren('history', 'id,assignment_doc_id,created_at', contextualAssignmentOverviewHistorySchema)
    const updated = new Map<string, string>()
    for (const row of history) if (!updated.has(row.assignment_doc_id) || row.created_at > updated.get(row.assignment_doc_id)!) updated.set(row.assignment_doc_id, row.created_at)
    const runRootSchema = contextualAssignmentOverviewControlSchema.extend({ runs: z.array(contextualAssignmentOverviewRunSchema).max(1) }).strict()
    const runRoot = await decode(queryFor(`${controlFields},runs:assignment_ai_grading_runs!assignment_ai_grading_runs_assignment_id_fkey(${runFields})`)
      .in('runs.status', ['queued', 'running']).order('created_at', { ascending: false, referencedTable: 'runs' }).order('id', { ascending: false, referencedTable: 'runs' })
      .limit(1, { referencedTable: 'runs' }).maybeSingle(), runRootSchema)
    const run = runRoot.runs[0]
    let activeAiGradingRun = null
    if (run) {
      if (run.assignment_id !== assignmentId) throw unavailable()
      const items: z.infer<typeof contextualAssignmentOverviewRunItemSchema>[] = []; const seen = new Set<string>(); let cursor: string | undefined
      const runIdentitySchema = contextualAssignmentOverviewRunSchema.pick({ id: true, assignment_id: true, status: true }).extend({ items: z.array(contextualAssignmentOverviewRunItemSchema).max(ASSIGNMENT_LIST_PAGE_SIZE) }).strict()
      const pageSchema = contextualAssignmentOverviewControlSchema.extend({ runs: z.array(runIdentitySchema).length(1) }).strict()
      for (;;) {
        let query = queryFor(`${controlFields},runs:assignment_ai_grading_runs!assignment_ai_grading_runs_assignment_id_fkey(id,assignment_id,status,items:assignment_ai_grading_run_items!assignment_ai_grading_run_items_run_id_fkey(${runItemFields}))`)
          .eq('runs.id', run.id).eq('runs.assignment_id', assignmentId).in('runs.status', ['queued', 'running']).limit(1, { referencedTable: 'runs' })
        if (cursor) query = query.gt('runs.items.id', cursor)
        const root = await decode(query.order('id', { ascending: true, referencedTable: 'runs.items' }).limit(ASSIGNMENT_LIST_PAGE_SIZE, { referencedTable: 'runs.items' }).maybeSingle(), pageSchema)
        const parent = root.runs[0]
        if (parent.id !== run.id || parent.assignment_id !== assignmentId) throw unavailable()
        if (!parent.items.length) break
        for (const item of parent.items) {
          if (item.assignment_id !== assignmentId || item.run_id !== run.id || seen.has(item.id) || (cursor && item.id <= cursor)) throw unavailable()
          add('items'); seen.add(item.id); items.push(item); cursor = item.id
        }
      }
      activeAiGradingRun = toAssignmentAiGradingRunSummary(run, { items: items as AssignmentAiGradingRunItem[] })
    }

    // Preserve one-hour private image links only after the statement-bound artifact proof.
    const signedArtifacts = artifacts.map(({ requirement: _requirement, managed_object: _object, ...artifact }) => artifact)
    const images = signedArtifacts.filter(a => a.type === 'image' && a.storage_path)
    for (let start = 0; start < images.length; start += ASSIGNMENT_LIST_BATCH_SIZE) {
      const batch = images.slice(start, start + ASSIGNMENT_LIST_BATCH_SIZE)
      const expected = new Map(batch.map(a => [a.id, a])); const parentIds = [...new Set(batch.map(a => a.assignment_doc_id))]
      const parentSchema = contextualAssignmentOverviewDocIdentitySchema.extend({ artifacts: z.array(contextualAssignmentOverviewArtifactSchema).max(ASSIGNMENT_LIST_BATCH_SIZE) }).strict()
      const proof = await decode(queryFor(`${controlFields},docs:assignment_docs!assignment_docs_assignment_id_fkey(${docIdentityFields},artifacts:assignment_submission_artifacts!assignment_submission_artifacts_assignment_doc_id_fkey(${artifactFields}))`)
        .in('docs.id', parentIds).in('docs.artifacts.id', batch.map(a => a.id)).neq('docs.student_id', actorId).eq('docs.participant.enrollment.classroom_id', classroomId)
        .eq('docs.artifacts.requirement.assignment_id', assignmentId).limit(ASSIGNMENT_LIST_BATCH_SIZE, { referencedTable: 'docs' })
        .limit(ASSIGNMENT_LIST_BATCH_SIZE, { referencedTable: 'docs.artifacts' }).maybeSingle(), contextualAssignmentOverviewControlSchema.extend({ docs: z.array(parentSchema).max(ASSIGNMENT_LIST_BATCH_SIZE) }).strict())
      if (proof.docs.length !== parentIds.length) throw unavailable()
      const parents = new Set<string>(); const proven = new Set<string>()
      for (const parent of proof.docs) {
        if (!parentIds.includes(parent.id) || parents.has(parent.id)) throw unavailable()
        assertDoc(parent); parents.add(parent.id)
        for (const artifact of parent.artifacts) {
          assertArtifact(artifact)
          const base = expected.get(artifact.id)
          if (!base || proven.has(artifact.id) || artifact.assignment_doc_id !== parent.id || artifact.student_id !== parent.student_id
            || artifact.requirement_id !== base.requirement_id || artifact.storage_path !== base.storage_path || artifact.managed_object_id !== base.managed_object_id) throw unavailable()
          proven.add(artifact.id)
        }
      }
      if (proven.size !== batch.length) throw unavailable()
      const result = await execute(input.supabase.storage.from('assignment-artifacts').createSignedUrls(batch.map(a => a.storage_path!), 3600))
      const signed = z.object({ data: z.array(z.object({ path: z.string(), signedURL: z.string().nullable(), signedUrl: z.string().nullable(), error: z.string().nullable() }).strict()).nullable(), error: z.unknown() }).strict().safeParse(result)
      if (!signed.success) throw unavailable()
      if (signed.data.error || !signed.data.data) continue
      const byPath = new Map(batch.map(a => [a.storage_path!, a])); const returnedPaths = new Set<string>()
      for (const row of signed.data.data) {
        if (!byPath.has(row.path) || returnedPaths.has(row.path)) throw unavailable()
        returnedPaths.add(row.path)
        if (!row.error) {
          if (!row.signedUrl || !row.signedURL) throw unavailable()
          const expectedUrl = new URL(input.supabase.storage.from('assignment-artifacts').getPublicUrl(row.path).data.publicUrl)
          const signedUrl = new URL(row.signedUrl)
          const expectedPath = expectedUrl.pathname.replace('/object/public/', '/object/sign/')
          if (signedUrl.origin !== expectedUrl.origin || signedUrl.pathname !== expectedPath || signedUrl.username || signedUrl.password || signedUrl.hash
            || signedUrl.searchParams.size !== 1 || !signedUrl.searchParams.get('token')) throw unavailable()
          for (const artifact of batch) if (artifact.storage_path === row.path) artifact.url = row.signedUrl
        }
      }
      if (returnedPaths.size !== byPath.size) throw unavailable()
    }
    await decode(queryFor().maybeSingle(), contextualAssignmentOverviewControlSchema)
    const byDoc = new Map<string, typeof signedArtifacts>()
    for (const artifact of signedArtifacts) { const rows = byDoc.get(artifact.assignment_doc_id) ?? []; rows.push(artifact); byDoc.set(artifact.assignment_doc_id, rows) }
    const students = enrollments.map(enrollment => {
      const doc = docByStudent.get(enrollment.student_id); const profile = enrollment.users.profiles
      const structured = doc ? byDoc.get(doc.id) ?? [] : []
      const merged = submissionArtifactsToAssignmentArtifacts(structured, requirements)
      const urls = new Set(merged.map(a => a.url).filter(Boolean))
      for (const artifact of doc ? extractAssignmentArtifacts(doc.content) : []) if (artifact.url && !urls.has(artifact.url)) { urls.add(artifact.url); merged.push(artifact) }
      const completion = getSubmissionRequirementCompletion(requirements, structured)
      return { student_id: enrollment.student_id, student_email: enrollment.users.email, student_first_name: profile?.first_name ?? null, student_last_name: profile?.last_name ?? null,
        student_name: profile ? `${profile.first_name} ${profile.last_name}`.trim() || null : null, status: calculateAssignmentStatus(assignment, doc as unknown as AssignmentDoc),
        student_updated_at: doc ? updated.get(doc.id) ?? null : null,
        doc: doc ? { is_submitted: doc.is_submitted, submitted_at: doc.submitted_at, updated_at: doc.updated_at, score_completion: doc.score_completion, score_thinking: doc.score_thinking,
          score_workflow: doc.score_workflow, graded_at: doc.graded_at, returned_at: doc.returned_at, teacher_cleared_at: doc.teacher_cleared_at, feedback_returned_at: doc.feedback_returned_at } : null,
        artifacts: merged, submission_artifacts: structured, submission_completion: { required_count: completion.requiredCount, completed_required_count: completion.completedRequiredCount,
          can_submit: completion.canSubmit, blocking_count: completion.blockingRequirementIds.length } }
    })
    students.sort((a, b) => (a.student_name || a.student_email).localeCompare(b.student_name || b.student_email))
    const result = { assignment: { id: assignment.id, classroom_id: classroomId, title: assignment.title, description: assignment.description,
      instructions_markdown: getAssignmentInstructionsMarkdown(assignment).markdown, rich_instructions: assignment.rich_instructions, due_at: assignment.due_at, position: assignment.position,
      is_draft: assignment.is_draft, released_at: assignment.released_at, track_authenticity: assignment.track_authenticity, submission_requirements: requirements,
      created_by: assignment.created_by, created_at: assignment.created_at, updated_at: assignment.updated_at }, classroom: assignment.classrooms, students, active_ai_grading_run: activeAiGradingRun }
    if (!boundedAssignmentListJson(result, ASSIGNMENT_LIST_DTO_BYTES)) throw unavailable()
    checkDeadline(); return result
  } catch (error) { if (error instanceof ApiError) throw error; throw unavailable() }
  finally { clearTimeout(timer) }
}
