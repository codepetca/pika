/** Facts and generated feedback remain byte-equivalent JSON values. Only the
 * restored run's operational authority is detached; no provider call occurs. */
export function detachRepoLightArchiveResources(resources: Record<string, Record<string, unknown>[]>): Record<string, Record<string, unknown>[]> {
  const next=structuredClone(resources)
  next.assignment_repolight_runs=(next.assignment_repolight_runs??[]).map(row=>({
    ...row,subject_binding_id:null,detached:true,
    status:['completed','failed','stale'].includes(String(row.status))?row.status:'stale',
    lease_token:null,lease_expires_at:null,next_retry_at:null,
  }))
  next.assignment_repolight_reports??=[]
  next.assignment_repolight_feedback_imports??=[]
  return next
}
