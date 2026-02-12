import { getServiceRoleClient } from '@/lib/supabase'
import type { ExecutedOperation, SyncSummary } from './types'

export async function loadLatestPayloadHashes(classroomId: string): Promise<Map<string, string>> {
  const supabase = getServiceRoleClient()

  const { data: jobs } = await supabase
    .from('sync_jobs')
    .select('id')
    .eq('classroom_id', classroomId)
    .eq('provider', 'teachassist')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(20)

  const jobIds = (jobs || []).map((job) => job.id)
  if (jobIds.length === 0) return new Map()

  const { data: items } = await supabase
    .from('sync_job_items')
    .select('entity_type, entity_key, payload_hash, created_at')
    .in('sync_job_id', jobIds)
    .eq('status', 'success')
    .order('created_at', { ascending: false })

  const map = new Map<string, string>()
  for (const item of items || []) {
    const key = `${item.entity_type}:${item.entity_key}`
    if (!map.has(key)) {
      map.set(key, item.payload_hash)
    }
  }

  return map
}

export async function insertSyncJob(input: {
  classroomId: string
  mode: 'dry_run' | 'execute'
  source: string
  sourcePayload: Record<string, unknown>
  createdBy: string
}) {
  const supabase = getServiceRoleClient()
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('sync_jobs')
    .insert({
      classroom_id: input.classroomId,
      provider: 'teachassist',
      mode: input.mode,
      status: 'running',
      source: input.source,
      source_payload: input.sourcePayload,
      started_at: now,
      created_by: input.createdBy,
    })
    .select('id, classroom_id, mode, status, source, source_payload')
    .single()

  if (error || !data) {
    throw new Error('Failed to create sync job')
  }

  return data
}

export async function insertSyncJobItems(syncJobId: string, results: ExecutedOperation[]) {
  const supabase = getServiceRoleClient()

  const rows = results.map((result) => ({
    sync_job_id: syncJobId,
    entity_type: result.entity_type,
    entity_key: result.entity_key,
    action: result.action,
    payload_hash: result.payload_hash,
    status: result.status,
    error_message: result.error_message || null,
    request_payload: result.payload,
    response_payload: result.response_payload || null,
    attempt_count: 1,
  }))

  const { error } = await supabase.from('sync_job_items').insert(rows)
  if (error) {
    throw new Error('Failed to persist sync job items')
  }
}

export function buildSyncSummary(results: ExecutedOperation[]): SyncSummary {
  return {
    planned: results.length,
    upserted: results.filter((result) => result.status === 'success' && result.action === 'upsert').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    failed: results.filter((result) => result.status === 'failed').length,
  }
}

export async function finalizeSyncJob(syncJobId: string, status: 'completed' | 'failed', summary: SyncSummary, error?: string) {
  const supabase = getServiceRoleClient()

  const { error: updateError } = await supabase
    .from('sync_jobs')
    .update({
      status,
      summary,
      error_message: error || null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', syncJobId)

  if (updateError) {
    throw new Error('Failed to finalize sync job')
  }
}
