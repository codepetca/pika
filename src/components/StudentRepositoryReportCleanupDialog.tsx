'use client'

import { useState } from 'react'
import { Button,ContentDialog,FormField,Input,Select } from '@/ui'
import { useLiveStudentCleanup } from '@/hooks/useLiveStudentCleanup'
import type { LiveCleanupStatus,LiveCleanupTarget } from '@/lib/validations/live-student-cleanup'

type CleanupState = {operation:LiveCleanupStatus|null;busy:boolean;ready:boolean;enabled:boolean;error:string;hasSaved:boolean;cleanupScope?:LiveCleanupTarget['scope']}
interface Props {
  classroomId:string
  classroomTitle:string
  targets:LiveCleanupTarget[]
  isOpen:boolean
  onClose:()=>void
  /** Refresh report-cleanup discovery only; this does not authorize classroom rejoining. */
  onReportsRemoved:()=>void
}

export function StudentRepositoryReportCleanupDialog(props:Props) {
  return props.isOpen ? <OpenReportCleanupDialog key={props.classroomId} {...props} /> : null
}
function OpenReportCleanupDialog(props:Props) {
  const [targets]=useState(props.targets)
  const [selected,setSelected]=useState('')
  const target=targets.find(item=>item.generation_id===selected)||null
  return <ContentDialog isOpen onClose={props.onClose} title="Remove repository reports" subtitle={props.classroomTitle} maxWidth="max-w-xl" showFooterClose={false}>
    <div className="space-y-4">
      <FormField label="Removed student"><Select value={selected} onChange={event=>setSelected(event.target.value)} disabled={Boolean(target)} placeholder="Select a removed student" options={targets.map(item=>({value:item.generation_id,label:item.email ? `${item.name} · ${item.email}` : item.name || 'Removed student'}))} /></FormField>
      {target ? <ConnectedReportCleanup key={target.generation_id} classroomId={props.classroomId} target={target} onClose={props.onClose} onReportsRemoved={props.onReportsRemoved} /> : <><p className="text-sm text-text-muted">Select a removed membership to review its repository reports. Classwork and other provider activity are outside this action.</p><Button variant="secondary" onClick={props.onClose}>Close</Button></>}
    </div>
  </ContentDialog>
}
function ConnectedReportCleanup({classroomId,target,onClose,onReportsRemoved}:{classroomId:string;target:LiveCleanupTarget;onClose:()=>void;onReportsRemoved:()=>void}) {
  const state=useLiveStudentCleanup(classroomId,target,(status?:LiveCleanupStatus)=>{if(status?.scope==='repolight_only'&&status.academic_preserved&&status.cleanup_completed&&!status.repolight_cleanup_pending)onReportsRemoved()},'repolight_only')
  return <RepositoryReportCleanupDetails target={target} state={state} onClose={onClose} onCheck={()=>{void state.refresh()}} onAdvance={confirmed=>{void state.advance(confirmed)}} />
}

/** Feature-owned presentation also renders deterministic Pattern Lab evidence. */
export function RepositoryReportCleanupDetails({target,state,onClose,onCheck,onAdvance}:{target:LiveCleanupTarget;state:CleanupState;onClose:()=>void;onCheck:()=>void;onAdvance:(confirmed:boolean)=>void}) {
  const [confirmation,setConfirmation]=useState('')
  const {operation,busy,ready,enabled,error,hasSaved}=state
  const scopeVerified=state.cleanupScope==='repolight_only' && (!operation || (operation.scope==='repolight_only' && operation.academic_preserved===true))
  const done=scopeVerified && operation?.cleanup_completed===true
  const blocked=!scopeVerified || Boolean(operation?.blockers?.length)
  const confirmationText=target.email||'REMOVE REPORTS'
  return <div className="space-y-4">
    <div className={`rounded-card border p-4 text-sm text-text-default ${done ? 'border-border bg-surface-2' : 'border-danger bg-danger-bg'}`}>
      <p className={`font-semibold ${done ? 'text-text-default' : 'text-danger'}`}>{done ? 'Report removal verified.' : 'Repository report removal cannot be undone.'}</p>
      <p className="mt-2">Classwork, grades, attendance, files, accounts and other provider activity are kept. This action does not complete classroom cleanup or change joining eligibility.</p>
    </div>
    <p role="status" aria-live="polite" className="text-sm text-text-default">{busy ? 'Checking repository-report cleanup…' : done ? 'Repository reports removed. Academic data and other provider activity are kept.' : operation?.repolight_cleanup_pending ? 'Waiting for repository-report cleanup. Academic data and other provider activity are kept.' : blocked && ready ? 'Repository-report cleanup scope could not be verified.' : ready ? enabled ? 'Ready to confirm repository report removal.' : 'Repository-report cleanup is paused. Saved progress can still be checked.' : 'Repository-report cleanup has not been verified.'}</p>
    {operation && !done && <p className="text-xs text-text-muted">Each Continue runs one report-cleanup step. Closing this dialog stops further requests.</p>}
    {!operation && ((ready&&enabled)||hasSaved) && <FormField label={`Type “${confirmationText}” to confirm`} hint={target.email ? 'The email address is case-sensitive.' : 'Confirm only repository report removal.'}><Input value={confirmation} onChange={event=>setConfirmation(event.target.value)} disabled={busy} autoComplete="off" /></FormField>}
    {error && <p role="alert" className="rounded-control border border-danger bg-danger-bg p-3 text-sm text-danger">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={onClose}>{done?'Done':'Close'}</Button>{!done && <Button variant="secondary" disabled={busy} onClick={onCheck}>Check progress</Button>}{!done&&(ready||hasSaved)&&<Button variant="danger" loading={busy} disabled={busy||!enabled||blocked||(!operation&&confirmation!==confirmationText)} onClick={()=>onAdvance(Boolean(operation)||confirmation===confirmationText)}>{operation?'Continue report cleanup':hasSaved?'Retry report removal':'Remove repository reports'}</Button>}</div>
  </div>
}
