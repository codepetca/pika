'use client'

import { useState } from 'react'
import { Button, ContentDialog, FormField, Input, Select } from '@/ui'
import { useLiveStudentCleanup } from '@/hooks/useLiveStudentCleanup'
import type { LiveCleanupTarget } from '@/lib/validations/live-student-cleanup'

type Props = {
  classroomId: string
  classroomTitle: string
  targets: LiveCleanupTarget[]
  isOpen: boolean
  onClose: () => void
  onCompleted: () => void
}

export function StudentPurgeDialog(props: Props) {
  // A target snapshot survives roster refresh on completion. Changing classrooms remounts it.
  const [targets] = useState(props.targets)
  const [selected, setSelected] = useState('')
  const target = targets.find(row => row.generation_id === selected) ?? null
  return <ContentDialog isOpen={props.isOpen} onClose={props.onClose}
    title="Clean up live class data" subtitle={props.classroomTitle} maxWidth="max-w-xl" showFooterClose={false}>
    <div className="space-y-4">
      <FormField label="Removed student">
        <Select value={selected} onChange={event => setSelected(event.target.value)}
          disabled={Boolean(target)} placeholder="Select a removed student"
          options={targets.map(row => ({ value: row.generation_id, label: row.email ? `${row.name} · ${row.email}` : row.name }))} />
      </FormField>
      {target ? <CleanupDetails key={selected} classroomId={props.classroomId} target={target}
        onCompleted={props.onCompleted} onClose={props.onClose} />
        : <p className="text-sm text-text-muted">Select one removed membership to review its cleanup.</p>}
    </div>
  </ContentDialog>
}

function CleanupDetails({ classroomId, target, onCompleted, onClose }: {
  classroomId: string; target: LiveCleanupTarget; onCompleted: () => void; onClose: () => void
}) {
  const [confirmation, setConfirmation] = useState('')
  const state = useLiveStudentCleanup(classroomId, target, onCompleted)
  const { operation, busy, ready, enabled, error, hasSaved } = state
  const done = operation?.cleanup_completed
  const blocked = Boolean(operation?.blockers?.length) || operation?.errors?.some(item => !item.retryable)
  const providerWaiting = operation && (operation.pal !== 'completed' || operation.bara !== 'deleted')
  const retryableFailure = operation?.errors?.some(item => item.retryable)
  return <div className="space-y-4">
    {!done && <div className="rounded-card border border-danger bg-danger-bg p-4 text-sm text-text-default">
      <p className="font-semibold text-danger">This cannot be undone.</p>
      <p className="mt-2">Permanently delete this removed student’s live classroom work, grades, attendance, files, and linked activity.</p>
      <p className="mt-2">Their account, other classes, classmates, and shared materials are kept.
        They can join again with fresh class data after verified cleanup.</p>
      <p className="mt-2 text-xs text-text-muted">Historical backups and inactive archives or exports are outside this cleanup; retention still applies.</p>
    </div>}
    <div role="status" aria-live="polite" className="text-sm text-text-default">
      {busy ? (operation ? 'Checking this cleanup step…' : 'Checking removed membership…')
        : done ? 'Cleanup verified. The student can now be added and join again with fresh class data.'
          : operation ? (!enabled ? 'Cleanup is paused. Saved progress is available.' : blocked ? 'Cleanup needs attention. Some data cannot yet be safely removed.'
            : retryableFailure ? 'A service request failed. You can retry the next step.'
              : providerWaiting ? 'Waiting for linked services.' : 'Classroom data cleanup is pending.')
            : ready ? (enabled ? 'Ready for confirmation.' : 'Cleanup is paused. You can check saved progress.') : 'Cleanup has not been verified.'}
    </div>
    {operation && !done && <p className="text-xs text-text-muted">Each Continue runs one step. No further steps run after you close this dialog. Reopen it to check or continue.</p>}
    {!operation && target.email && ((ready && enabled) || hasSaved) && <FormField label={`Type “${target.email}” to confirm`} hint="The email address is case-sensitive.">
      <Input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" disabled={busy} />
    </FormField>}
    {error && <p role="alert" className="rounded-control border border-danger bg-danger-bg p-3 text-sm text-danger">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="secondary" onClick={onClose}>{done ? 'Done' : 'Close'}</Button>
      {!done && <Button variant="secondary" onClick={() => void state.refresh()} disabled={busy}>Check progress</Button>}
      {!done && (ready || (hasSaved && !operation)) && <Button variant="danger" loading={busy}
        disabled={busy || (!(hasSaved && !operation) && (!ready || !enabled)) || blocked || (!operation && (!target.email || confirmation !== target.email))}
        onClick={() => void state.advance(Boolean(operation) || confirmation === target.email)}>
        {operation ? 'Continue cleanup' : hasSaved ? 'Retry saved request' : 'Delete live class data'}
      </Button>}
    </div>
  </div>
}
