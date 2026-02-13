import { ingestDataset } from './ingestor'
import { normalizeDataset } from './normalizer'
import { validateDataset } from './validator'
import { mapDatasetToOperations } from './mapper'
import { planOperations } from './planner'
import { TeachAssistApiClient } from './client'
import { executeOperations } from './executor'
import {
  buildSyncSummary,
  finalizeSyncJob,
  insertSyncJob,
  insertSyncJobItems,
  loadLatestPayloadHashes,
} from './state-store'
import type { SyncMode } from './types'

export async function runTeachAssistSyncJob(input: {
  classroomId: string
  mode: SyncMode
  source: string
  payload: unknown
  createdBy: string
}) {
  const job = await insertSyncJob({
    classroomId: input.classroomId,
    mode: input.mode,
    source: input.source,
    sourcePayload: (input.payload || {}) as Record<string, unknown>,
    createdBy: input.createdBy,
  })

  try {
    const dataset = normalizeDataset(ingestDataset(input.payload))
    const errors = validateDataset(dataset)

    if (errors.length > 0) {
      await finalizeSyncJob(job.id, 'failed', { planned: 0, upserted: 0, skipped: 0, failed: 0 }, errors.join('; '))
      return {
        jobId: job.id,
        ok: false as const,
        errors,
      }
    }

    const mapped = mapDatasetToOperations(dataset)
    const latestHashes = await loadLatestPayloadHashes(input.classroomId)
    const planned = planOperations(mapped, latestHashes)

    const client = new TeachAssistApiClient()
    const results = await executeOperations(input.mode, planned, client)

    await insertSyncJobItems(job.id, results)

    const summary = buildSyncSummary(results)
    const status = summary.failed > 0 ? 'failed' : 'completed'
    await finalizeSyncJob(job.id, status, summary, summary.failed > 0 ? 'Some items failed' : undefined)

    return {
      jobId: job.id,
      ok: summary.failed === 0,
      summary,
    }
  } catch (error: any) {
    await finalizeSyncJob(job.id, 'failed', { planned: 0, upserted: 0, skipped: 0, failed: 0 }, error?.message || 'Unexpected sync error')
    return {
      jobId: job.id,
      ok: false as const,
      errors: [error?.message || 'Unexpected sync error'],
    }
  }
}
