import type { ExecutedOperation, PlannedOperation, SyncMode } from './types'
import type { TeachAssistClient } from './client'

export async function executeOperations(
  mode: SyncMode,
  planned: PlannedOperation[],
  client: TeachAssistClient
): Promise<ExecutedOperation[]> {
  const results: ExecutedOperation[] = []

  for (const item of planned) {
    if (item.action === 'noop') {
      results.push({ ...item, status: 'skipped' })
      continue
    }

    if (mode === 'dry_run') {
      results.push({ ...item, status: 'success', response_payload: { dry_run: true } })
      continue
    }

    try {
      const response = await client.upsert(item.entity_type, item.payload)
      results.push({ ...item, status: 'success', response_payload: response })
    } catch (error: any) {
      results.push({
        ...item,
        status: 'failed',
        error_message: error?.message || 'Unknown execution error',
      })
    }
  }

  return results
}
