import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import type { getServiceRoleClient } from '@/lib/supabase'
import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { parseContentField } from '@/lib/tiptap-content'
import { isAssignmentVisibleToStudents } from '@/lib/assignments'
import { normalizeClassroomFeatureVisibility } from '@/lib/classroom-feature-visibility'
import { courseGuideReadJsonFingerprint } from '@/lib/validations/contextual-course-guide-read'
import { contextualAssignmentOverviewEnvelopeSchema } from '@/lib/validations/contextual-assignment-overview-read'
import { ASSIGNMENT_LIST_BATCH_SIZE, ASSIGNMENT_LIST_COLLECTION_LIMIT, ASSIGNMENT_LIST_DEADLINE_MS, ASSIGNMENT_LIST_DTO_BYTES, ASSIGNMENT_LIST_PAGE_SIZE,
  ASSIGNMENT_LIST_STATEMENT_LIMIT, boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import { openContextualAssignmentDoc } from '@/lib/server/contextual-assignment-doc-open'
import { isPalEnabled, isClassroomPalRequested } from '@/lib/server/pal-config'
import { buildLearningItemViewedEvent } from '@/lib/server/pal-events'
import { attemptImmediatePalEventDelivery, type PalImmediateDeliveryStatus } from '@/lib/server/pal-outbox'
import { assignmentLearnerOpenIdentitySchema, learnerOpenControlSchema, learnerOpenRootSchema, learnerOpenAssignmentSchema,
  learnerOpenDocSchema, learnerOpenGradeSchema, learnerOpenFeedbackSchema, learnerOpenRequirementSchema, learnerOpenArtifactSchema,
  learnerOpenFeedbackEntrySchema, learnerOpenDocIdentitySchema, learnerOpenGitHubSchema, learnerOpenMembershipSchema,
} from '@/lib/validations/contextual-assignment-learner-open'

type Client = ReturnType<typeof getServiceRoleClient>
const unavailable = () => new ApiError(503, 'Unable to verify learner assignment document')
const fields = (schema: z.ZodObject) => Object.keys(schema.shape).join(',')
const classroomRelation = 'classrooms!assignments_classroom_id_fkey!inner'
const classroomFields = 'id,teacher_id,archived_at,feature_visibility'
const membershipRelation = 'membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner'
const membershipFields = 'id,classroom_id,student_id'
const assignmentControlFields = 'id,classroom_id,is_draft,released_at,created_at'
const controlFields = `${assignmentControlFields},${classroomRelation}(${classroomFields},${membershipRelation}(${membershipFields}))`
const docsRelation = 'docs:assignment_docs!assignment_docs_assignment_id_fkey'
const artifactFields = `${fields(learnerOpenArtifactSchema.omit({ requirement: true, managed_object: true }))},requirement:assignment_submission_requirements!assignment_submission_artifacts_requirement_id_fkey!inner(id,assignment_id,type),managed_object:managed_storage_objects!assignment_submission_artifacts_managed_object_id_fkey(id,classroom_id,data_subject_user_id,resource_type,resource_id,purpose,status,storage_bucket,storage_path)`

/** The RPC owns create/view side effects. Subsequent reads prove statement-current learner authority, not an atomic snapshot. */
export async function openSharedAssignmentLearnerDoc(input: { supabase: Client; actorId: string; assignmentId: string }) {
  const identity = assignmentLearnerOpenIdentitySchema.safeParse({ actorId: input.actorId, assignmentId: input.assignmentId })
  if (!identity.success) throw new ApiError(400, 'Invalid assignment open request')
  const { actorId, assignmentId } = identity.data
  const now = new Date(); const releaseExclusive = new Date(now.getTime() + 1).toISOString()
  const controller = new AbortController(); const deadline = Date.now() + ASSIGNMENT_LIST_DEADLINE_MS
  const timer = setTimeout(() => controller.abort(), ASSIGNMENT_LIST_DEADLINE_MS)
  let statements = 0
  const check = () => { if (controller.signal.aborted || Date.now() >= deadline) throw unavailable() }
  async function execute(query: PromiseLike<unknown> | (() => PromiseLike<unknown>)) {
    check(); if (++statements > ASSIGNMENT_LIST_STATEMENT_LIMIT) throw unavailable()
    // Storage SDK methods return hot promises; invoke only after both guards.
    const pending = typeof query === 'function' ? query() : query
    const result = await new Promise<unknown>((resolve, reject) => {
      const abort = () => reject(unavailable())
      controller.signal.addEventListener('abort', abort, { once: true })
      Promise.resolve(pending).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort))
    })
    check(); if (!boundedAssignmentListJson(result, ASSIGNMENT_LIST_DTO_BYTES)) throw unavailable()
    return result
  }
  async function envelope<T extends z.ZodType>(query: PromiseLike<unknown>, schema: T): Promise<z.infer<T> | null> {
    const parsed = contextualAssignmentOverviewEnvelopeSchema(schema).safeParse(await execute(query))
    if (!parsed.success) throw unavailable()
    return (parsed.data as unknown as { data: z.infer<T> | null }).data
  }
  try {
    const initial = await envelope(input.supabase.from('assignments')
      .select(`${assignmentControlFields},${classroomRelation}(${classroomFields})`).eq('id', assignmentId).abortSignal(controller.signal).maybeSingle(), learnerOpenControlSchema)
    if (!initial) throw new ApiError(404, 'Assignment not found')
    if (initial.id !== assignmentId || initial.classroom_id !== initial.classrooms.id) throw unavailable()
    if (initial.classrooms.teacher_id === actorId) throw new ApiError(403, 'Forbidden')
    if (initial.classrooms.archived_at || !normalizeClassroomFeatureVisibility(initial.classrooms.feature_visibility).classwork || !isAssignmentVisibleToStudents(initial, now)) {
      throw new ApiError(404, 'Assignment not found')
    }
    const classroomId = initial.classroom_id; const ownerId = initial.classrooms.teacher_id
    const visibility = courseGuideReadJsonFingerprint(initial.classrooms.feature_visibility)
    function queryFor(select = controlFields) {
      return input.supabase.from('assignments').select(select).eq('id', assignmentId).eq('classroom_id', classroomId).eq('is_draft', false)
        .or(`released_at.is.null,released_at.lt.${releaseExclusive}`)
        .eq('classrooms.id', classroomId).eq('classrooms.teacher_id', ownerId).neq('classrooms.teacher_id', actorId).is('classrooms.archived_at', null)
        .eq('classrooms.membership.classroom_id', classroomId).eq('classrooms.membership.student_id', actorId)
        .limit(2, { referencedTable: 'classrooms.membership' }).abortSignal(controller.signal)
    }
    function assertRoot(row: unknown) {
      if (!row || typeof row !== 'object') throw unavailable()
      const candidate = row as z.infer<typeof learnerOpenRootSchema>
      const parsed = learnerOpenRootSchema.safeParse({ id: candidate.id, classroom_id: candidate.classroom_id, is_draft: candidate.is_draft,
        released_at: candidate.released_at, created_at: candidate.created_at, classrooms: { ...candidate.classrooms,
          membership: candidate.classrooms?.membership?.map(member => ({ id: member.id, classroom_id: member.classroom_id, student_id: member.student_id })) } })
      if (!parsed.success) throw unavailable()
      const root = parsed.data; const member = root.classrooms.membership[0]
      if (root.id !== assignmentId || root.classroom_id !== classroomId || root.classrooms.id !== classroomId || root.classrooms.teacher_id !== ownerId
        || root.classrooms.teacher_id === actorId || root.classrooms.archived_at !== null || member.classroom_id !== classroomId || member.student_id !== actorId
        || root.is_draft || root.released_at !== initial!.released_at || root.created_at !== initial!.created_at || !isAssignmentVisibleToStudents(root, now)
        || courseGuideReadJsonFingerprint(root.classrooms.feature_visibility) !== visibility || !normalizeClassroomFeatureVisibility(root.classrooms.feature_visibility).classwork) throw unavailable()
    }
    const preflightSchema = learnerOpenControlSchema.extend({ classrooms: learnerOpenControlSchema.shape.classrooms.extend({ membership: z.array(learnerOpenMembershipSchema).max(1) }).strict() }).strict()
    // A left membership embed distinguishes a genuinely absent member from a
    // missing guarded parent; every later statement uses the inner relationship.
    const preflightFields = controlFields.replace(membershipRelation, membershipRelation.replace('!inner', ''))
    const preflight = await envelope(queryFor(preflightFields).maybeSingle(), preflightSchema)
    if (!preflight) throw unavailable()
    if (preflight.id !== assignmentId || preflight.classroom_id !== classroomId || preflight.classrooms.id !== classroomId
      || preflight.classrooms.teacher_id !== ownerId || preflight.classrooms.archived_at !== null || preflight.is_draft
      || preflight.released_at !== initial.released_at || preflight.created_at !== initial.created_at
      || courseGuideReadJsonFingerprint(preflight.classrooms.feature_visibility) !== visibility) throw unavailable()
    if (!preflight.classrooms.membership.length) throw new ApiError(403, 'Forbidden')
    assertRoot(preflight)
    async function decode<T extends z.ZodType>(query: PromiseLike<unknown>, schema: T): Promise<z.infer<T>> {
      const row = await envelope(query, schema); if (!row) throw unavailable(); assertRoot(row); return row
    }
    const palEnabled = isPalEnabled()
    const event = palEnabled && !isClassroomPalRequested() ? buildLearningItemViewedEvent({ learnerId: actorId, itemId: assignmentId, occurredAt: now,
      releasedAt: initial.released_at ?? initial.created_at }) : null
    // Bound the raw RPC envelope before its existing parser traverses passthrough JSON.
    const opened = await openContextualAssignmentDoc({ supabase: { rpc: async (name, args) => {
      const result = await execute(input.supabase.rpc(name, args).abortSignal(controller.signal))
      const raw = result as { data?: { assignment?: { rich_instructions?: unknown }; doc?: { content?: unknown } } }
      if (raw.data?.assignment && !boundedAssignmentListJson(raw.data.assignment.rich_instructions, 2 * 1024 * 1024)) throw unavailable()
      if (raw.data?.doc && !boundedAssignmentListJson(raw.data.doc.content, 2 * 1024 * 1024)) throw unavailable()
      return result as Awaited<ReturnType<Client['rpc']>>
    } }, actorId, assignmentId, viewedAt: now.toISOString(), event })
    if (opened.assignment.classroom_id !== classroomId) throw unavailable()
    let palDelivery: PalImmediateDeliveryStatus | undefined
    // Preserve immediate delivery after committed creation, before any supplement can fail.
    if (opened.created && palEnabled) {
      palDelivery = await attemptImmediatePalEventDelivery({ membership: { studentId: actorId, classroomId }, event, supabase: input.supabase })
    }
    check()
    const docId = opened.doc.id
    const assignment = await decode(queryFor(`${fields(learnerOpenAssignmentSchema.omit({ classrooms: true }))},${classroomRelation}(${classroomFields},${membershipRelation}(${membershipFields}))`).maybeSingle(), learnerOpenAssignmentSchema)
    function exactDocQuery(select: string, alias = 'docs') {
      return queryFor(`${controlFields},${alias}:assignment_docs!assignment_docs_assignment_id_fkey(${select})`).eq(`${alias}.id`, docId)
        .eq(`${alias}.assignment_id`, assignmentId).eq(`${alias}.student_id`, actorId).limit(2, { referencedTable: alias })
    }
    function assertDoc(row: { id: string; assignment_id: string; student_id: string }) {
      if (row.id !== docId || row.assignment_id !== assignmentId || row.student_id !== actorId) throw unavailable()
    }
    const docRoot = await decode(exactDocQuery(fields(learnerOpenDocSchema)).maybeSingle(), learnerOpenRootSchema.extend({ docs: z.array(learnerOpenDocSchema).length(1) }).strict())
    const baseDoc = docRoot.docs[0]; assertDoc(baseDoc)
    const gradeDefaults = { score_completion: null, score_thinking: null, score_workflow: null, graded_at: null, graded_by: null, authenticity_score: null, authenticity_flags: null }
    let grading: z.infer<typeof learnerOpenGradeSchema> | typeof gradeDefaults = gradeDefaults
    if (baseDoc.returned_at) {
      const root = await decode(exactDocQuery(fields(learnerOpenGradeSchema), 'grades').eq('grades.returned_at', baseDoc.returned_at).maybeSingle(),
        learnerOpenRootSchema.extend({ grades: z.array(learnerOpenGradeSchema).length(1) }).strict())
      assertDoc(root.grades[0]); if (root.grades[0].returned_at !== baseDoc.returned_at) throw unavailable(); grading = root.grades[0]
    }
    function bindReturns(query: ReturnType<typeof exactDocQuery>, alias: string) {
      query = baseDoc.returned_at === null ? query.is(`${alias}.returned_at`, null) : query.eq(`${alias}.returned_at`, baseDoc.returned_at)
      return baseDoc.feedback_returned_at === null ? query.is(`${alias}.feedback_returned_at`, null) : query.eq(`${alias}.feedback_returned_at`, baseDoc.feedback_returned_at)
    }
    let feedbackBody: string | null = null
    if (baseDoc.returned_at || baseDoc.feedback_returned_at) {
      const root = await decode(bindReturns(exactDocQuery(fields(learnerOpenFeedbackSchema), 'released_feedback'), 'released_feedback').maybeSingle(),
        learnerOpenRootSchema.extend({ released_feedback: z.array(learnerOpenFeedbackSchema).length(1) }).strict())
      const released = root.released_feedback[0]; assertDoc(released)
      if (released.returned_at !== baseDoc.returned_at || released.feedback_returned_at !== baseDoc.feedback_returned_at) throw unavailable(); feedbackBody = released.feedback
    }
    async function collection<T extends z.ZodType<{ id: string; assignment_id: string }>>(kind: 'requirements' | 'feedback', relation: string, schema: T) {
      const rows: z.infer<T>[] = []; const seen = new Set<string>(); let cursor: string | undefined
      for (;;) {
        let query = queryFor(`${controlFields},${kind}:${relation}(${fields(schema as unknown as z.ZodObject)})`).eq(`${kind}.assignment_id`, assignmentId)
        if (kind === 'feedback') query = query.eq('feedback.student_id', actorId)
        if (cursor) query = query.gt(`${kind}.id`, cursor)
        const root = await decode(query.order('id', { ascending: true, referencedTable: kind }).limit(ASSIGNMENT_LIST_PAGE_SIZE, { referencedTable: kind }).maybeSingle(),
          learnerOpenRootSchema.extend({ [kind]: z.array(schema).max(ASSIGNMENT_LIST_PAGE_SIZE) }).strict())
        const page = (root as unknown as Record<string, z.infer<T>[]>)[kind]
        if (!page.length) return rows
        for (const row of page) {
          if (row.assignment_id !== assignmentId || seen.has(row.id) || (cursor && row.id <= cursor) || rows.length >= ASSIGNMENT_LIST_COLLECTION_LIMIT) throw unavailable()
          if (kind === 'feedback' && (row as z.infer<typeof learnerOpenFeedbackEntrySchema>).student_id !== actorId) throw unavailable()
          seen.add(row.id); rows.push(row); cursor = row.id
        }
      }
    }
    const requirements = await collection('requirements', 'assignment_submission_requirements!assignment_submission_requirements_assignment_id_fkey', learnerOpenRequirementSchema)
    const requirementMap = new Map(requirements.map(row => [row.id, row]))
    const feedback = await collection('feedback', 'assignment_feedback_entries!assignment_feedback_entries_assignment_id_fkey', learnerOpenFeedbackEntrySchema)
    const artifacts: z.infer<typeof learnerOpenArtifactSchema>[] = []; const seenArtifacts = new Set<string>(); const seenRequirements = new Set<string>(); let cursor: string | undefined
    function artifactQuery() {
      return queryFor(`${controlFields},${docsRelation}!inner(${fields(learnerOpenDocIdentitySchema)},artifacts:assignment_submission_artifacts!assignment_submission_artifacts_assignment_doc_id_fkey(${artifactFields}))`)
        .eq('docs.id', docId).eq('docs.assignment_id', assignmentId).eq('docs.student_id', actorId).limit(2, { referencedTable: 'docs' })
        .eq('docs.artifacts.assignment_doc_id', docId).eq('docs.artifacts.student_id', actorId).eq('docs.artifacts.requirement.assignment_id', assignmentId)
    }
    const artifactRootSchema = learnerOpenRootSchema.extend({ docs: z.array(learnerOpenDocIdentitySchema.extend({ artifacts: z.array(learnerOpenArtifactSchema).max(ASSIGNMENT_LIST_PAGE_SIZE) }).strict()).length(1) }).strict()
    function assertArtifact(artifact: z.infer<typeof learnerOpenArtifactSchema>) {
      const requirement = requirementMap.get(artifact.requirement_id); const object = artifact.managed_object
      if (artifact.assignment_doc_id !== docId || artifact.student_id !== actorId || !requirement || artifact.requirement.id !== requirement.id
        || artifact.requirement.assignment_id !== assignmentId || artifact.requirement.type !== artifact.type || requirement.type !== artifact.type) throw unavailable()
      if (artifact.managed_object_id === null ? object !== null : !object || object.id !== artifact.managed_object_id || object.classroom_id !== classroomId
        || object.data_subject_user_id !== actorId || object.resource_id !== docId || object.storage_path !== artifact.storage_path) throw unavailable()
      if (artifact.storage_path === null ? artifact.managed_object_id !== null : artifact.type !== 'image') throw unavailable()
      if (artifact.storage_path) {
        const path = artifact.storage_path
        if (path.includes('\\') || path.split('/').some(part => part === '.' || part === '..')) throw unavailable()
        const legacyPrefix = `${actorId}/${assignmentId}/${requirement.id}-`
        const legacy = path.startsWith(legacyPrefix) && /^\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[\s\S]+$/.test(path.slice(legacyPrefix.length))
        const uploadPrefix = object ? `classrooms/${classroomId}/students/${actorId}/assignment-docs/${docId}/artifacts/${object.id}.` : ''
        const upload = !!object && path.startsWith(uploadPrefix) && path.length > uploadPrefix.length
        const restored = !!object && new RegExp(`^restores/${classroomId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}-[0-9a-f]{64}$`).test(path)
        if (!legacy && !upload && !restored) throw unavailable()
      }
    }
    for (;;) {
      let query = artifactQuery()
      if (cursor) query = query.gt('docs.artifacts.id', cursor)
      const root = await decode(query.order('id', { ascending: true, referencedTable: 'docs.artifacts' }).limit(ASSIGNMENT_LIST_PAGE_SIZE, { referencedTable: 'docs.artifacts' }).maybeSingle(), artifactRootSchema)
      assertDoc(root.docs[0]); const page = root.docs[0].artifacts; if (!page.length) break
      for (const artifact of page) {
        assertArtifact(artifact)
        if (seenArtifacts.has(artifact.id) || seenRequirements.has(artifact.requirement_id) || (cursor && artifact.id <= cursor) || artifacts.length >= ASSIGNMENT_LIST_COLLECTION_LIMIT) throw unavailable()
        seenArtifacts.add(artifact.id); seenRequirements.add(artifact.requirement_id); artifacts.push(artifact); cursor = artifact.id
      }
    }
    const publicArtifacts = artifacts.map(({ requirement: _requirement, managed_object: _object, ...artifact }) => artifact)
    const images = artifacts.filter(artifact => artifact.type === 'image' && artifact.storage_path)
    for (let start = 0; start < images.length; start += ASSIGNMENT_LIST_BATCH_SIZE) {
      const batch = images.slice(start, start + ASSIGNMENT_LIST_BATCH_SIZE); const expected = new Map(batch.map(artifact => [artifact.id, artifact]))
      const root = await decode(artifactQuery().in('docs.artifacts.id', batch.map(artifact => artifact.id))
        .order('id', { ascending: true, referencedTable: 'docs.artifacts' }).limit(ASSIGNMENT_LIST_BATCH_SIZE, { referencedTable: 'docs.artifacts' }).maybeSingle(), artifactRootSchema)
      assertDoc(root.docs[0]); const proven = new Set<string>()
      for (const artifact of root.docs[0].artifacts) {
        assertArtifact(artifact); const original = expected.get(artifact.id)
        if (!original || proven.has(artifact.id) || courseGuideReadJsonFingerprint(artifact) !== courseGuideReadJsonFingerprint(original)) throw unavailable()
        proven.add(artifact.id)
      }
      if (proven.size !== batch.length) throw unavailable()
      const raw = await execute(() => input.supabase.storage.from('assignment-artifacts').createSignedUrls(batch.map(artifact => artifact.storage_path!), 3600))
      const signed = z.object({ data: z.array(z.object({ path: z.string(), signedURL: z.string().nullable(), signedUrl: z.string().nullable(), error: z.string().nullable() }).strict()).max(ASSIGNMENT_LIST_BATCH_SIZE), error: z.null() }).strict().safeParse(raw)
      if (!signed.success) throw unavailable()
      const byPath = new Map(batch.map(artifact => [artifact.storage_path!, artifact])); const returned = new Set<string>()
      if (byPath.size !== batch.length) throw unavailable()
      for (const row of signed.data.data) {
        if (!byPath.has(row.path) || returned.has(row.path) || row.error || !row.signedUrl || !row.signedURL) throw unavailable()
        const expectedUrl = new URL(input.supabase.storage.from('assignment-artifacts').getPublicUrl(row.path).data.publicUrl)
        const url = new URL(row.signedUrl)
        if (url.origin !== expectedUrl.origin || url.pathname !== expectedUrl.pathname.replace('/object/public/', '/object/sign/')
          || url.username || url.password || url.hash || url.searchParams.size !== 1 || !url.searchParams.get('token')) throw unavailable()
        returned.add(row.path)
        const artifactId = byPath.get(row.path)!.id
        publicArtifacts.find(artifact => artifact.id === artifactId)!.url = row.signedUrl
      }
      if (returned.size !== byPath.size) throw unavailable()
    }
    const identityRootSchema = learnerOpenRootSchema.extend({ classrooms: learnerOpenRootSchema.shape.classrooms.extend({ membership: z.array(learnerOpenMembershipSchema.extend({
      users: z.object({ id: z.string().uuid(), github_identity: learnerOpenGitHubSchema.nullable() }).strict(),
    }).strict()).length(1) }).strict() }).strict()
    const identityRoot = await decode(queryFor(`${assignmentControlFields},${classroomRelation}(${classroomFields},${membershipRelation}(${membershipFields},users!classroom_enrollments_student_id_fkey!inner(id,github_identity:user_github_identities!user_github_identities_user_id_fkey(${fields(learnerOpenGitHubSchema)}))))`).maybeSingle(), identityRootSchema)
    const user = identityRoot.classrooms.membership[0].users
    if (user.id !== actorId || (user.github_identity && user.github_identity.user_id !== actorId)) throw unavailable()
    const finalRoot = await decode(bindReturns(exactDocQuery(fields(learnerOpenDocSchema.pick({ id: true, assignment_id: true, student_id: true, returned_at: true, feedback_returned_at: true }))), 'docs').maybeSingle(),
      learnerOpenRootSchema.extend({ docs: z.array(learnerOpenDocSchema.pick({ id: true, assignment_id: true, student_id: true, returned_at: true, feedback_returned_at: true })).length(1) }).strict())
    assertDoc(finalRoot.docs[0])
    if (finalRoot.docs[0].returned_at !== baseDoc.returned_at || finalRoot.docs[0].feedback_returned_at !== baseDoc.feedback_returned_at) throw unavailable()
    const { classrooms: _classrooms, ...assignmentFields } = assignment
    const { id: _gradeId, assignment_id: _gradeAssignment, student_id: _gradeActor, returned_at: _gradeReturn, ...gradeFields } = 'id' in grading ? grading : { ...grading, id: null, assignment_id: null, student_id: null, returned_at: null }
    const parsedContent = parseContentField(baseDoc.content)
    if (!boundedAssignmentListJson(parsedContent, 2 * 1024 * 1024)) throw unavailable()
    requirements.sort((a, b) => a.position - b.position || Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
    feedback.sort((a, b) => Date.parse(a.returned_at) - Date.parse(b.returned_at) || Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
    const result = { assignment: { ...assignmentFields, instructions_markdown: getAssignmentInstructionsMarkdown(assignmentFields).markdown },
      doc: { ...baseDoc, content: parsedContent, ...gradeFields, feedback: feedbackBody }, feedback_entries: feedback,
      submission_requirements: requirements, submission_artifacts: publicArtifacts,
      github_identity: user.github_identity, wasFirstView: opened.viewed_at_changed, ...(palDelivery === undefined ? {} : { pal_delivery: palDelivery }) }
    if (!boundedAssignmentListJson(result, ASSIGNMENT_LIST_DTO_BYTES)) throw unavailable(); check(); return result
  } catch (error) { if (error instanceof ApiError) throw error; throw unavailable() }
  finally { clearTimeout(timer) }
}
