import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => { throw new Error('No database allowed') }) }))
import wire from './fixture.json'
import { sourceFixture } from './adapter-fixtures'
import { CLASSROOM_ARCHIVE_V2_RESOURCES } from '@/lib/contracts/classroom-archive-resources'
import { buildClassroomArchiveBundle, discoverClassroomStorageReferences, verifyClassroomArchiveBundle } from '@/lib/server/classroom-archive-format'
import { buildClassroomArchiveV2RestorePlan } from '@/lib/server/classroom-archive-restore'
import { digestRepoLightJson, prepareRepoLightCreate } from '@/lib/server/repolight-client'
import { getAssignmentRepoLightReport, type RepoLightDependencies } from '@/lib/server/assignment-repolight-runs'

const uuid = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`
describe('RepoLight facts through the actual TypeScript archive pipeline', () => {
  it('preserves full report evidence and receipts while ordinary managed URLs still relocate', async () => {
    const source = sourceFixture(), actor = source.classroom.teacher_id, student = source.enrollment.student_id
    const origin = 'https://project.supabase.co', sourcePath = 'teacher/image.png', imageId = uuid(40)
    const managedUrl = `${origin}/storage/v1/object/public/submission-images/${sourcePath}`
    const authoringUrl = `/api/storage/authoring-images?object_id=${imageId}`
    const ghostUrl = `${origin}/storage/v1/object/public/submission-images/opaque-facts-only.png`
    const historical = `${managedUrl} ${authoringUrl} ${ghostUrl} /api/storage/authoring-images?object_id=${uuid(45)}`
    const bundle = structuredClone(wire.bundle)
    const sha = bundle.overview.facts.commits[0].sha
    for (const analysis of [bundle.overview, ...bundle.contributors.map(row => row.analysis)]) {
      const commit = analysis.facts.commits.find(row => row.sha === sha)
      if (commit) commit.message += ` ${historical}`
    }
    const sourceJson = { ...source, classroom: { ...source.classroom, historicalNote: historical } }
    const prepared = prepareRepoLightCreate({ ...wire.envelope, clientBinding: {
      ...wire.envelope.clientBinding, sourceRevisionRef: digestRepoLightJson(sourceJson),
    } })
    const reportDigest = digestRepoLightJson(bundle)
    const result = { schemaVersion: '1.0', analysisId: bundle.bundleRef, reportRef: bundle.bundleRef,
      requestFingerprint: prepared.requestFingerprint, clientBinding: prepared.envelope.clientBinding, reportDigest, bundle }
    const run = { id: uuid(20), subject_binding_id: uuid(21), detached: false, classroom_id: source.assignment.classroom_id,
      assignment_id: source.assignment.id, student_id: student, actor_id: actor,
      source_json: sourceJson, source_fingerprint: digestRepoLightJson(sourceJson),
      connection_json: { connectionRef: 'connection-1', workspaceRef: 'customer_1', installationRef: 'pika-installation' },
      request_json: prepared.envelope.request, create_envelope: prepared.envelope, request_fingerprint: prepared.requestFingerprint,
      idempotency_key: `pika-${uuid(20)}`, analysis_id: bundle.bundleRef, status: 'completed', attempt_count: 1,
      next_retry_at: null, lease_token: null, lease_generation: 1, lease_expires_at: null, error_code: null,
      created_at: '2026-10-24T12:00:00Z', completed_at: '2026-10-24T12:00:01Z' }
    const report = { run_id: run.id, assignment_id: run.assignment_id, student_id: student,
      result_json: result, report_digest: reportDigest }
    const receipt = { id: uuid(41), run_id: run.id, assignment_id: run.assignment_id, student_id: student, actor_id: actor,
      doc_ack: { teacher_feedback_draft: historical }, report_digest: reportDigest }
    const resources: Record<string, Record<string, unknown>[]> = Object.fromEntries(CLASSROOM_ARCHIVE_V2_RESOURCES.map(row => [row.table, []]))
    Object.assign(resources, {
      classrooms: [{ id: run.classroom_id, teacher_id: actor, title: 'Synthetic archive' }],
      assignments: [{ id: run.assignment_id, classroom_id: run.classroom_id, created_by: actor, instructions_markdown: `${managedUrl} ${authoringUrl}` }],
      assignment_docs: [{ id: source.doc.id, assignment_id: run.assignment_id, student_id: student, content: managedUrl }],
      assignment_repolight_runs: [run], assignment_repolight_reports: [report], assignment_repolight_feedback_imports: [receipt],
    })
    const actors = [{ id: actor, email: 'teacher@example.test', role: 'teacher', profile: null },
      { id: student, email: 'student@example.test', role: 'student', profile: null }]
    expect(discoverClassroomStorageReferences(resources, origin)).toEqual([{ bucket: 'submission-images', path: sourcePath }])
    const exported = buildClassroomArchiveBundle({ version: 2, archiveId: uuid(42), classroomId: run.classroom_id,
      teacherId: actor, createdAt: '2026-10-24T12:05:00Z', source: { schemaMigration: '293_repolight_report_service', appCommit: 'abcdef1' },
      retention: { mode: 'teacher_managed', delete_after: null }, resources, actors,
      storageObjects: [{ bucket: 'submission-images', sourcePath, contentType: 'image/png', bytes: Buffer.from('synthetic-image'),
        managedOwner: { objectId: uuid(44), purpose: 'student_inline_image', createdByUserId: student,
          dataSubjectUserId: student, resourceType: 'assignment_doc', resourceId: source.doc.id } },
        { bucket: 'test-documents', sourcePath: 'authoring/image.png', contentType: 'image/png', bytes: Buffer.from('synthetic-authoring-image'),
          managedOwner: { objectId: imageId, purpose: 'teacher_authoring_image', createdByUserId: actor,
            dataSubjectUserId: null, resourceType: 'classroom', resourceId: run.classroom_id } }],
    })
    const verified = verifyClassroomArchiveBundle(exported.archive)
    expect(verified.ok).toBe(true)
    if (!verified.ok) throw new Error('Synthetic archive verification failed')
    const plan = buildClassroomArchiveV2RestorePlan({ verified, artifactChecksumVerified: true, operationId: uuid(43),
      currentActors: actors.map(({ id, email, role }) => ({ id, email, role })), supabaseUrl: origin })
    expect(plan.resources.assignment_repolight_reports).toEqual([report])
    expect(plan.resources.assignment_repolight_feedback_imports).toEqual([receipt])
    expect(plan.resources.assignment_repolight_runs[0]).toEqual({ ...run, detached: true, subject_binding_id: null, poll_failure_count: 0 })
    expect(plan.resources.assignments[0].instructions_markdown).toContain(plan.storageObjects.find(row => row.bucket === 'submission-images')!.restorePath)
    expect(plan.resources.assignments[0].instructions_markdown).toContain(plan.storageObjects.find(row => row.purpose === 'teacher_authoring_image')!.managedObjectId)
    expect(plan.resources.assignments[0].instructions_markdown).not.toContain(authoringUrl)
    const forbidden = vi.fn(async () => { throw new Error('Cached reads must not mutate or call a provider') })
    const database = { read: vi.fn(async () => ({ data: { ...plan.resources.assignment_repolight_runs[0], source_current: true,
      report: plan.resources.assignment_repolight_reports[0].result_json }, error: null })), source: forbidden, begin: forbidden, advance: forbidden, importFeedback: forbidden }
    const cached = await getAssignmentRepoLightReport(actor, { assignmentId: run.assignment_id, studentId: student }, run.id,
      { database } satisfies RepoLightDependencies)
    expect(cached.report).toEqual({ reportDigest, bundle, assignmentSummary: null })
    expect(cached.run).toMatchObject({ reportAvailable: true, canAdvance: false, canImport: false })
  })
})
