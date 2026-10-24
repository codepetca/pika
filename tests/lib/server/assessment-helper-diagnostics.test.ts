import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectContentFreeDiagnostic, privateDiagnosticError } from '../../helpers/diagnostics'
import { ensureAssessmentDraft, saveTestDraftAtomic } from '@/lib/server/assessment-drafts'
import * as snapshotCleanup from '@/lib/server/test-document-snapshot-storage-cleanup'
import { updateTestDocumentsAtomic } from '@/lib/server/test-document-authoring'
import { createProvisionalTestDocumentSnapshotCleanup, removeQueuedTestDocumentSnapshotPath, runTestDocumentSnapshotStorageCleanup } from '@/lib/server/test-document-snapshot-storage-cleanup'
import { createProvisionalAssignmentArtifactStorageCleanup, removeQueuedAssignmentArtifactStoragePath, runAssignmentArtifactStorageCleanup } from '@/lib/server/assignment-artifact-storage-cleanup'
import { collectAssignmentImageArtifactStoragePaths, collectRemovedImageArtifactStoragePaths, deleteAssignmentSubmissionArtifactAtomic, removeAssignmentArtifactStorageObjects, updateAssignmentWithSubmissionRequirementsAtomic } from '@/lib/server/assignment-submission-artifacts'
import { saveAssignmentDocAtomic, submitAssignmentDocAtomic, unsubmitAssignmentDocAtomic } from '@/lib/server/assignment-doc-submissions'

afterEach(() => vi.restoreAllMocks())

const storagePath = 'PRIVATE_STUDENT/PRIVATE_ASSESSMENT/PRIVATE_DOCUMENT'
const cleanup = {
  id: '10000000-0000-4000-8000-000000000001',
  lease_token: '10000000-0000-4000-8000-000000000002',
  storage_path: storagePath,
}

function queryResult(result: unknown) {
  const query: any = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) }
  for (const name of ['select', 'eq', 'order', 'insert', 'update']) query[name] = vi.fn(() => query)
  query.single = query.maybeSingle = vi.fn(async () => result)
  return query
}

describe('assessment helper diagnostics', () => {
  it.each(['fetch', 'baseline', 'repair', 'create'] as const)('keeps draft %s failures content-free', async stage => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failed = { data: null, error: privateDiagnosticError }
    const draft = stage === 'repair' ? { id: 'PRIVATE_DRAFT', content: {}, version: 1 } : null
    const from = vi.fn()
      .mockReturnValueOnce(queryResult(stage === 'fetch' ? failed : { data: draft, error: null }))
      .mockReturnValueOnce(queryResult(stage === 'baseline' ? failed : { data: [], error: null }))
      .mockReturnValueOnce(queryResult(failed))
    const result = await ensureAssessmentDraft({ from }, {
      assessmentType: 'test',
      assessment: { id: 'PRIVATE_TEST', classroom_id: 'PRIVATE_CLASS', title: 'PRIVATE_TITLE', show_results: false },
      userId: 'PRIVATE_TEACHER', questionsTable: 'test_questions', questionsForeignKey: 'test_id', questionsSelect: '*',
      validateContent: () => ({ valid: false, error: 'PRIVATE_CONTENT' }), buildFromRows: () => ({}),
    })
    expect(result).toMatchObject({ ok: false, status: 500 })
    expectContentFreeDiagnostic(consoleError.mock.calls, `assessment_draft.${stage}`)
  })

  it('keeps atomic document-update errors content-free', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await updateTestDocumentsAtomic({
      supabase: { rpc: vi.fn().mockResolvedValue({ data: null, error: privateDiagnosticError }) },
      teacherId: 'PRIVATE_TEACHER', testId: 'PRIVATE_TEST', expectedStatus: 'draft', expectedDocuments: [], proposedDocuments: [],
    })
    expect(result).toEqual({ ok: false, status: 500, error: 'Failed to update test' })
    expectContentFreeDiagnostic(consoleError.mock.calls, 'test_document.update')
  })

  it.each(['draft', 'documents'] as const)('keeps committed %s saves successful after immediate cleanup rejects', async operation => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(snapshotCleanup, 'removeQueuedTestDocumentSnapshotPath').mockRejectedValue(privateDiagnosticError)
    const test = { id: 'PRIVATE_TEST' }
    const draft = { id: 'PRIVATE_DRAFT' }
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { test, draft, cleanup_paths: [`link-docs/${storagePath}`] }, error: null }) }
    const result = operation === 'draft'
      ? await saveTestDraftAtomic(supabase, { teacherId: storagePath, testId: storagePath, expectedDraftVersion: 1, content: { title: 'PRIVATE_TITLE', show_results: false, questions: [] } })
      : await updateTestDocumentsAtomic({ supabase, teacherId: storagePath, testId: storagePath, expectedStatus: 'draft', expectedDocuments: [], proposedDocuments: [] })
    expect(result).toMatchObject({ ok: true, test })
    expectContentFreeDiagnostic(consoleError.mock.calls, operation === 'draft' ? 'assessment_draft.cleanup' : 'test_document.cleanup')
  })

  it.each([
    ['save', saveAssignmentDocAtomic], ['submit', submitAssignmentDocAtomic],
  ] as const)('keeps assignment %s failures content-free', async (operation, mutate) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const content = { type: 'doc' as const, content: [] }
    const result = await mutate({
      supabase: { rpc: vi.fn().mockResolvedValue({ data: null, error: privateDiagnosticError }) },
      assignmentId: storagePath, studentId: storagePath, previousContent: content, content,
      expectedUpdatedAt: '2026-10-24T12:00:00Z', trigger: 'autosave', pasteWordCount: 0, keystrokeCount: 0,
      saveSessionId: storagePath, saveSequence: 1, metricSessionId: storagePath,
    })
    expect(result).toMatchObject({ ok: false, status: 500 })
    expectContentFreeDiagnostic(consoleError.mock.calls, `assignment_document.${operation}`)
  })

  it.each(['returned', 'malformed'] as const)('keeps assignment atomic %s results content-free', async kind => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await unsubmitAssignmentDocAtomic({
      supabase: { rpc: vi.fn().mockResolvedValue(kind === 'returned'
        ? { data: null, error: privateDiagnosticError } : { data: { ok: true, doc: { id: storagePath } }, error: null }) },
      assignmentId: 'PRIVATE_ASSIGNMENT', studentId: 'PRIVATE_STUDENT',
    })
    expect(result).toMatchObject({ ok: false, status: 500 })
    expectContentFreeDiagnostic(consoleError.mock.calls, kind === 'returned' ? 'assignment_document.unsubmit' : 'assignment_document.result', kind === 'returned' ? 'database' : 'unexpected')
  })

  it.each(['update', 'delete'] as const)('keeps artifact %s malformed results content-free', async operation => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { ok: 'PRIVATE_ANSWER' }, error: null }) }
    const result = operation === 'update'
      ? await updateAssignmentWithSubmissionRequirementsAtomic({ supabase, assignmentId: storagePath, updates: {}, requirements: [] })
      : await deleteAssignmentSubmissionArtifactAtomic({ supabase, assignmentId: storagePath, studentId: storagePath, requirementId: storagePath })
    expect(result).toMatchObject({ ok: false, status: 500 })
    expectContentFreeDiagnostic(consoleError.mock.calls, operation === 'update' ? 'assignment_artifact.requirements_result' : 'assignment_artifact.delete_result', 'unexpected')
  })

  it.each(['update', 'delete'] as const)('keeps artifact %s returned errors content-free', async operation => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: null, error: privateDiagnosticError }) }
    const result = operation === 'update'
      ? await updateAssignmentWithSubmissionRequirementsAtomic({ supabase, assignmentId: storagePath, updates: {}, requirements: [] })
      : await deleteAssignmentSubmissionArtifactAtomic({ supabase, assignmentId: storagePath, studentId: storagePath, requirementId: storagePath })
    expect(result).toMatchObject({ ok: false, status: 500 })
    expectContentFreeDiagnostic(consoleError.mock.calls, operation === 'update' ? 'assignment_artifact.requirements_update' : 'assignment_artifact.delete')
  })

  it.each(['collect', 'collect_removed'] as const)('keeps artifact %s rejection content-free and best-effort', async operation => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = { from: () => { throw privateDiagnosticError } }
    const result = operation === 'collect'
      ? await collectAssignmentImageArtifactStoragePaths(supabase, storagePath)
      : await collectRemovedImageArtifactStoragePaths(supabase, storagePath, [])
    expect(result).toEqual([])
    expectContentFreeDiagnostic(consoleError.mock.calls, `assignment_artifact.${operation}`)
  })

  it.each([false, true])('keeps artifact removal rejection=%s content-free and best-effort', async rejected => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const remove = rejected ? vi.fn().mockRejectedValue(privateDiagnosticError) : vi.fn().mockResolvedValue({ error: privateDiagnosticError })
    await expect(removeAssignmentArtifactStorageObjects({ storage: { from: () => ({ remove }) } }, [storagePath], 'PRIVATE_CONTEXT')).resolves.toBeUndefined()
    expectContentFreeDiagnostic(consoleError.mock.calls, 'assignment_artifact.remove')
  })
})

describe.each(['test', 'assignment'] as const)('%s cleanup diagnostic sinks', kind => {
  const provisional = kind === 'test' ? createProvisionalTestDocumentSnapshotCleanup : createProvisionalAssignmentArtifactStorageCleanup
  const removePath = kind === 'test' ? removeQueuedTestDocumentSnapshotPath : removeQueuedAssignmentArtifactStoragePath
  const run = kind === 'test' ? runTestDocumentSnapshotStorageCleanup : runAssignmentArtifactStorageCleanup
  const prefix = kind === 'test' ? 'test_snapshot_cleanup' : 'assignment_artifact_cleanup'
  const relation = kind === 'test' ? 'test_document_snapshot_storage_cleanup' : 'assignment_artifact_storage_cleanup'

  it.each(['returned', 'rejected', 'malformed'] as const)('keeps provisional %s failures content-free', async mode => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = mode === 'returned' ? { data: null, error: privateDiagnosticError } : { data: { id: storagePath }, error: null }
    const from = mode === 'rejected' ? vi.fn(() => { throw privateDiagnosticError }) : vi.fn(() => queryResult(result))
    await expect(provisional({ supabase: { from }, storagePath })).resolves.toBeNull()
    expectContentFreeDiagnostic(consoleError.mock.calls, `${prefix}.provision`, mode === 'malformed' ? 'unexpected' : 'database')
  })

  it.each(['returned', 'rejected', 'malformed'] as const)('keeps batch claim %s failures content-free and bounded', async mode => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rpc = mode === 'rejected' ? vi.fn().mockRejectedValue(privateDiagnosticError) : vi.fn().mockResolvedValue(mode === 'returned'
      ? { data: null, error: privateDiagnosticError } : { data: [{ id: storagePath }], error: null })
    await expect(run({ supabase: { rpc }, limit: 1 })).resolves.toEqual({ claimAttempts: 1, claimFailures: 1, claimed: 0, completed: 0, failed: 1 })
    expectContentFreeDiagnostic(consoleError.mock.calls, kind === 'assignment' && mode === 'malformed' ? `${prefix}.claim_result` : `${prefix}.claim`, mode === 'malformed' ? 'unexpected' : 'database')
  })

  it.each([false, true])('persists only a fixed Storage failure when rejection=%s', async rejected => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const remove = rejected ? vi.fn().mockRejectedValue(new Error(privateDiagnosticError.message)) : vi.fn().mockResolvedValue({ error: privateDiagnosticError })
    const rpc = vi.fn(async (name: string) => {
      if (name === `claim_${relation}_path`) return { data: [cleanup], error: null }
      if (name === 'test_document_snapshot_path_is_referenced') return { data: false, error: null }
      if (name === `fail_${relation}`) return { data: true, error: null }
      throw new Error('Unexpected synthetic RPC')
    })
    const supabase = { rpc, from: () => queryResult({ data: null, error: null }), storage: { from: () => ({ remove }) } }
    await expect(removePath({ supabase, storagePath })).resolves.toEqual({ completed: false })
    expect(rpc).toHaveBeenCalledWith(`fail_${relation}`, {
      p_cleanup_id: cleanup.id, p_lease_token: cleanup.lease_token, p_error: 'Storage request failed',
    })
    if (kind === 'assignment') expectContentFreeDiagnostic(consoleError.mock.calls, `${prefix}.remove`, rejected ? 'unexpected' : 'database')
    else expect(consoleError).not.toHaveBeenCalled()
  })

  it.each([
    ['reference', false], ['reference', true],
    ['storage', false], ['storage', true],
    ['completion', false], ['completion', true],
  ] as const)('keeps batch %s rejection=%s out of durable diagnostics', async (stage, rejected) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failResult = () => {
      if (rejected) throw privateDiagnosticError
      return { data: null, error: privateDiagnosticError }
    }
    const rpc = vi.fn(async (name: string) => {
      if (name === `claim_${relation}`) return { data: [cleanup], error: null }
      if (name === 'test_document_snapshot_path_is_referenced') return stage === 'reference' ? failResult() : { data: false, error: null }
      if (name === `complete_${relation}`) return stage === 'completion' ? failResult() : { data: true, error: null }
      if (name === `fail_${relation}`) return { data: true, error: null }
      throw new Error('Unexpected synthetic RPC')
    })
    const from = () => {
      if (stage === 'reference' && rejected) throw privateDiagnosticError
      return queryResult(stage === 'reference' ? { data: null, error: privateDiagnosticError } : { data: null, error: null })
    }
    const remove = vi.fn(async () => stage === 'storage' ? failResult() : { error: null })
    await expect(run({ supabase: { rpc, from, storage: { from: () => ({ remove }) } }, limit: 1 })).resolves.toEqual({
      claimAttempts: 1, claimFailures: 0, claimed: 1, completed: 0, failed: 1,
    })
    const fixedError = stage === 'reference'
      ? kind === 'test' ? 'Snapshot reference lookup failed' : 'Artifact reference lookup failed'
      : stage === 'storage' ? 'Storage request failed'
        : kind === 'assignment' ? 'Completion RPC failed' : 'Failed to record Storage cleanup completion'
    expect(rpc).toHaveBeenCalledWith(`fail_${relation}`, {
      p_cleanup_id: cleanup.id, p_lease_token: cleanup.lease_token, p_error: fixedError,
    })
    if (kind === 'test' && stage === 'reference') expectContentFreeDiagnostic(consoleError.mock.calls, `${prefix}.reference`)
    else if (stage === 'completion' && (kind === 'assignment' || rejected)) expectContentFreeDiagnostic(consoleError.mock.calls, `${prefix}.complete`)
    else expect(consoleError).not.toHaveBeenCalled()
    if (stage === 'reference') expect(remove).not.toHaveBeenCalled()
  })
})
