import { getServiceRoleClient } from '@/lib/supabase'
import type { TableUpdate } from '@/types/database'
import type { Json } from '@/types/database.generated'
import type { AssignmentAiGradingRun, AssignmentAiGradingRunItem } from '@/types'

type ServiceRoleSupabase = ReturnType<typeof getServiceRoleClient>

type DatabaseError = {
  code?: string
  message?: string
}

export class AssignmentAiGradingLeaseLostError extends Error {
  constructor() {
    super('Assignment AI grading worker lease was lost')
    this.name = 'AssignmentAiGradingLeaseLostError'
  }
}

function isLeaseLostError(error: DatabaseError | null): boolean {
  return error?.code === '40001'
    && error.message?.includes('Assignment AI grading lease was lost') === true
}

export async function patchAssignmentAiGradingRunWithLease(opts: {
  supabase: ServiceRoleSupabase
  runId: string
  leaseToken: string
  leaseFencingEnabled: boolean
  patch: Json
}): Promise<AssignmentAiGradingRun> {
  if (!opts.leaseFencingEnabled) {
    const { data, error } = await opts.supabase
      .from('assignment_ai_grading_runs')
      .update(opts.patch as TableUpdate<'assignment_ai_grading_runs'>)
      .eq('id', opts.runId)
      .select('*')
      .single()
    if (error || !data) {
      throw new Error('Failed to update assignment AI grading run')
    }
    return data as unknown as AssignmentAiGradingRun
  }

  const { data, error } = await opts.supabase.rpc('patch_assignment_ai_grading_run_with_lease_v1', {
    p_run_id: opts.runId,
    p_lease_token: opts.leaseToken,
    p_patch: opts.patch,
  })

  if (isLeaseLostError(error)) {
    throw new AssignmentAiGradingLeaseLostError()
  }
  if (error || !data) {
    throw new Error('Failed to update assignment AI grading run')
  }

  return data as unknown as AssignmentAiGradingRun
}

export async function patchAssignmentAiGradingItemWithLease(opts: {
  supabase: ServiceRoleSupabase
  itemId: string
  leaseToken: string
  leaseFencingEnabled: boolean
  patch: Json
}): Promise<AssignmentAiGradingRunItem | null> {
  if (!opts.leaseFencingEnabled) {
    const { error } = await opts.supabase
      .from('assignment_ai_grading_run_items')
      .update(opts.patch as TableUpdate<'assignment_ai_grading_run_items'>)
      .eq('id', opts.itemId)
      .in('status', ['queued', 'processing'])
    if (error) {
      throw new Error('Failed to update assignment AI grading run item')
    }
    return null
  }

  const { data, error } = await opts.supabase.rpc('patch_assignment_ai_grading_item_with_lease_v1', {
    p_item_id: opts.itemId,
    p_lease_token: opts.leaseToken,
    p_patch: opts.patch,
  })

  if (isLeaseLostError(error)) {
    throw new AssignmentAiGradingLeaseLostError()
  }
  if (error || !data) {
    throw new Error('Failed to update assignment AI grading run item')
  }

  return data as AssignmentAiGradingRunItem
}
