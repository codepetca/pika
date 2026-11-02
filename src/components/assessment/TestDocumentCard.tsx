'use client'

import { ExternalLink, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { Button, CircularProgress } from '@/ui'

/** Shared reference-card presentation; the owner handles persistence and opening. */
export function TestDocumentCard({ title, isLink, canOpen, disabled, refreshDisabled = false, syncing = false, syncLabel, onRefresh, onEdit, onOpen, onRemove }: {
  title: string
  isLink: boolean
  canOpen: boolean
  disabled: boolean
  refreshDisabled?: boolean
  syncing?: boolean
  syncLabel?: string
  onRefresh?: () => void
  onEdit: () => void
  onOpen: () => void
  onRemove: () => void
}) {
  return <div className="rounded-lg border border-border bg-surface px-3 py-2">
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0"><p className="truncate text-sm font-medium text-text-default">{title}</p></div>
      <div className="flex items-center gap-2">
        {isLink && <>
          {syncLabel && <span className="text-xs text-text-muted" aria-label={`Synced ${syncLabel} ago`}>{syncLabel}</span>}
          <Button type="button" variant="secondary" size="sm" className="px-2" onClick={onRefresh} disabled={disabled || refreshDisabled || syncing} aria-label={`Refresh ${title}`}>
            {syncing ? <CircularProgress /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </>}
        <Button type="button" variant="secondary" size="sm" className="px-2" onClick={onEdit} disabled={disabled} aria-label={`Edit ${title}`}><Pencil className="h-4 w-4" /></Button>
        <Button type="button" variant="secondary" size="sm" className="px-2" onClick={onOpen} disabled={!canOpen} aria-label={`Open ${title}`}><ExternalLink className="h-4 w-4" /></Button>
        <Button type="button" variant="danger" size="sm" className="px-2" onClick={onRemove} disabled={disabled} aria-label={`Remove ${title}`}><Trash2 className="h-4 w-4" /></Button>
      </div>
    </div>
  </div>
}
