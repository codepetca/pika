import type { ManagedRepoLightRecord, ManagedRepoLightStore } from './repolight-managed'
import { ManagedRepoLightError } from './repolight-managed'
import { getServiceRoleClient } from '@/lib/supabase'
import type { Database } from '@/types/database'

/** Exact service-only RPC transport; names and wire arguments are checked
 * against the generated public schema, including the JSON candidate boundary. */
export type ManagedRepoLightRpcArgs = {
  get_repolight_analysis_access_v1: { p_subject_user_id: string }
  read_repolight_managed_connection_v1: { p_teacher_id: string; p_connection_ref?: string }
  prepare_repolight_managed_connection_v1: { p_teacher_id: string; p_candidate: ManagedRepoLightRecord }
  prepare_repolight_managed_rotation_v1: { p_teacher_id: string; p_candidate: ManagedRepoLightRecord }
  activate_repolight_managed_connection_v1: { p_teacher_id: string; p_expected: ManagedRepoLightRecord; p_workspace_ref: string }
}
export type ManagedRepoLightRpc = <Name extends keyof ManagedRepoLightRpcArgs>(name: Name, args: ManagedRepoLightRpcArgs[Name]) => PromiseLike<{ data: unknown; error: { code?: string } | null }>

export function createManagedRepoLightServiceDatabase(
  db: Pick<ReturnType<typeof getServiceRoleClient>, 'rpc'> = getServiceRoleClient(),
): ManagedRepoLightStore {
  return createManagedRepoLightDatabase((name, args) => db.rpc(name, args satisfies Database['public']['Functions'][typeof name]['Args']))
}

export function createManagedRepoLightDatabase(call: ManagedRepoLightRpc): ManagedRepoLightStore {
  async function result(reply: ReturnType<ManagedRepoLightRpc>) {
    try {
      const { data, error } = await reply
      if (error) {
        const denied = ['42501', 'P2961'].includes(error.code ?? '')
        throw new ManagedRepoLightError(denied ? 'repolight_managed_ineligible' : 'repolight_managed_storage_unavailable', !denied && error.code !== '22023')
      }
      return data
    } catch (error) {
      if (error instanceof ManagedRepoLightError) throw error
      throw new ManagedRepoLightError('repolight_managed_storage_unavailable', true)
    }
  }
  return {
    access: teacherId => result(call('get_repolight_analysis_access_v1', { p_subject_user_id: teacherId })),
    read: (teacherId, connectionRef) => result(call('read_repolight_managed_connection_v1', { p_teacher_id: teacherId, ...(connectionRef ? { p_connection_ref: connectionRef } : {}) })),
    prepare: candidate => result(call('prepare_repolight_managed_connection_v1', { p_teacher_id: candidate.teacherId, p_candidate: candidate })),
    prepareRotation: candidate => result(call('prepare_repolight_managed_rotation_v1', { p_teacher_id: candidate.teacherId, p_candidate: candidate })),
    activate: (row, workspaceRef) => result(call('activate_repolight_managed_connection_v1', { p_teacher_id: row.teacherId, p_expected: row, p_workspace_ref: workspaceRef })),
  }
}
