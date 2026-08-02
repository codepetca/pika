import {
  managedTestDocumentStorageClaims,
  preserveCurrentTestDocumentSnapshots,
} from '@/lib/test-documents'
import {
  removeQueuedTestDocumentSnapshotPath,
} from '@/lib/server/test-document-snapshot-storage-cleanup'
import type { TestDocument } from '@/types'

type SupabaseLike = any

type AtomicDocumentUpdateInput = {
  supabase: SupabaseLike
  teacherId: string
  testId: string
  expectedStatus: string
  expectedDocuments: unknown
  proposedDocuments: TestDocument[]
  title?: string
  status?: string
  showResults?: boolean
}

export type AtomicDocumentUpdateResult =
  | {
      ok: true
      test: Record<string, unknown>
      cleanupPaths: string[]
    }
  | {
      ok: false
      status: number
      error: string
    }

function parseCleanupPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((path): path is string => (
    typeof path === 'string' && path.startsWith('link-docs/')
  ))
}

export async function updateTestDocumentsAtomic(
  input: AtomicDocumentUpdateInput,
): Promise<AtomicDocumentUpdateResult> {
  const documents = preserveCurrentTestDocumentSnapshots(
    input.expectedDocuments,
    input.proposedDocuments,
  )
  const managedStorageClaims = managedTestDocumentStorageClaims(documents)
  if (!managedStorageClaims) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid managed test document reference',
    }
  }
  const expectedManagedStorageClaims = managedTestDocumentStorageClaims(
    input.expectedDocuments,
  )
  if (!expectedManagedStorageClaims) {
    return {
      ok: false,
      status: 409,
      error: 'Existing managed test document ownership could not be verified. Reload and try again.',
    }
  }
  const { data, error } = await input.supabase.rpc(
    'update_test_documents_managed_atomic',
    {
      p_documents: documents,
      p_expected_documents: input.expectedDocuments ?? [],
      p_expected_status: input.expectedStatus,
      p_show_results: input.showResults ?? false,
      p_status: input.status ?? input.expectedStatus,
      p_teacher_id: input.teacherId,
      p_test_id: input.testId,
      p_title: input.title ?? '',
      p_managed_storage_claims: managedStorageClaims,
      p_expected_managed_storage_claims: expectedManagedStorageClaims,
      p_update_show_results: input.showResults !== undefined,
      p_update_status: input.status !== undefined,
      p_update_title: input.title !== undefined,
    },
  )

  if (error) {
    const details = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
    if (details.includes('document_conflict')) {
      return {
        ok: false,
        status: 409,
        error: 'The test documents changed elsewhere. Reload and try again.',
      }
    }
    if (details.includes('classroom_archived')) {
      return { ok: false, status: 403, error: 'Classroom is archived' }
    }
    if (details.includes('forbidden')) {
      return { ok: false, status: 403, error: 'Forbidden' }
    }
    if (details.includes('test_not_found')) {
      return { ok: false, status: 404, error: 'Test not found' }
    }
    if (details.includes('managed_test_document_owner_mismatch')) {
      return {
        ok: false,
        status: 409,
        error: 'Uploaded document ownership could not be verified. Reload and upload it again.',
      }
    }
    if (details.includes('update_test_documents_managed_atomic')) {
      return {
        ok: false,
        status: 503,
        error: 'Managed test document updates require migration 117 to be applied',
      }
    }
    console.error('Error updating test documents atomically:', error)
    return { ok: false, status: 500, error: 'Failed to update test' }
  }

  const result = data as {
    cleanup_paths?: unknown
    test?: Record<string, unknown>
  } | null
  if (!result?.test) {
    return { ok: false, status: 500, error: 'Failed to update test' }
  }

  const cleanupPaths = parseCleanupPaths(result.cleanup_paths)
  for (const storagePath of cleanupPaths) {
    try {
      await removeQueuedTestDocumentSnapshotPath({
        supabase: input.supabase,
        storagePath,
      })
    } catch (cleanupError) {
      console.error('Failed to run immediate test snapshot cleanup:', {
        storagePath,
        cleanupError,
      })
    }
  }

  return { ok: true, test: result.test, cleanupPaths }
}
