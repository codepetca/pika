'use client'

import { useEffect, useState } from 'react'
import { Eye } from 'lucide-react'
import { ContentDialog, IconButton, SplitButton } from '@/ui'
import { CreationModalShell, CreationModalTopRow } from '@/components/creation/CreationModalShell'
import { ContentField, RichTextEditor, RichTextViewer } from '@/components/editor'
import type { TiptapContent } from '@/types'

interface MaterialCreationDialogProps {
  isOpen: boolean
  isExisting?: boolean
  isDraft?: boolean
  readOnly?: boolean
  saving?: boolean
  error?: string | null
  title: string
  content: TiptapContent
  onTitleChange: (title: string) => void
  onContentChange: (content: TiptapContent) => void
  onSave: (asDraft: boolean) => void
  onClose: () => void
  onDelete?: () => void
}

/** Material-owned presentation; callers retain persistence and permission checks. */
export function MaterialCreationDialog({
  isOpen, isExisting = false, isDraft = true, readOnly = false, saving = false,
  error, title, content, onTitleChange, onContentChange, onSave, onClose, onDelete,
}: MaterialCreationDialogProps) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [saveAsDraft, setSaveAsDraft] = useState(false)
  const disabled = saving || readOnly
  const publishLabel = isDraft ? 'Post' : 'Save'

  useEffect(() => {
    setPreviewOpen(false)
    setSaveAsDraft(false)
  }, [isOpen])

  if (!isOpen) return null

  return (
    <>
      <CreationModalShell
        isOpen={isOpen}
        onClose={onClose}
        title={isExisting ? 'Material' : 'New Material'}
        titleId="material-modal-title"
        closeLabel="Close material modal"
        closeDisabled={saving}
        contentClassName="!overflow-hidden"
        tall
        showTitle
      >
        <div className="flex h-full min-h-0 flex-col gap-3">
          <CreationModalTopRow
            title={title}
            titlePlaceholder="Add a title"
            titleDisabled={disabled}
            titleInitialFocus
            titleFieldClassName="col-span-2 !max-w-none sm:col-span-1 sm:!max-w-96"
            titleStatus={<span className="text-xs text-text-muted">{isExisting ? isDraft ? 'Draft' : 'Posted' : 'Not posted'}</span>}
            className="shrink-0 grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(9rem,1fr)_auto_auto]"
            onTitleChange={onTitleChange}
            afterTitle={<IconButton icon={Eye} label="Preview" variant="secondary" disabled={saving} onClick={() => setPreviewOpen(true)} />}
            actions={(
              <SplitButton
                label={saving ? 'Saving…' : saveAsDraft ? 'Save draft' : publishLabel}
                variant={!saveAsDraft && isDraft ? 'success' : 'primary'}
                size="md"
                disabled={disabled}
                toggleAriaLabel="Choose material action"
                menuPlacement="down"
                primaryButtonProps={{ className: 'min-w-24 justify-center font-semibold' }}
                onPrimaryClick={() => { if (!disabled) onSave(saveAsDraft) }}
                options={[
                  { id: saveAsDraft ? 'post' : 'draft', label: saveAsDraft ? publishLabel : 'Save draft', onSelect: () => setSaveAsDraft(!saveAsDraft) },
                  ...(onDelete && !readOnly ? [{ id: 'delete', label: 'Delete material', destructive: true, onSelect: onDelete }] : []),
                ]}
              />
            )}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ContentField label="Content" className="flex min-h-64 h-full flex-col">
              <RichTextEditor
                content={content}
                onChange={onContentChange}
                editable={!disabled}
                placeholder="Add links, notes, readings, or instructions…"
                toolbarPreset="compact"
                aria-label="Material content"
                className="simple-editor-wrapper--fill-height min-h-0 flex-1 overflow-hidden rounded-lg border border-border-strong"
              />
            </ContentField>
          </div>
          {error && <p role="alert" className="shrink-0 text-sm text-danger">{error}</p>}
        </div>
      </CreationModalShell>
      <ContentDialog isOpen={isOpen && previewOpen} onClose={() => setPreviewOpen(false)} title="Material preview" maxWidth="!max-w-2xl">
        <div className="mb-4">
          <p className="text-sm font-medium text-text-muted">Material</p>
          <h2 className="mt-1 text-2xl font-semibold text-text-default">{title.trim() || 'Untitled material'}</h2>
        </div>
        <RichTextViewer content={content} />
      </ContentDialog>
    </>
  )
}
