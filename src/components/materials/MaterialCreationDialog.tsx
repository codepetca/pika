'use client'

import { useRef, useState } from 'react'
import { Eye } from 'lucide-react'
import { Button, ContentDialog, FormField, IconButton, SegmentedControl, SplitButton } from '@/ui'
import { useMaterialMarkdownDraft } from '@/hooks/use-material-markdown-draft'
import { CreationModalShell, CreationModalTopRow } from '@/components/creation/CreationModalShell'
import { ContentField, RichTextEditor, RichTextViewer } from '@/components/editor'
import type { TiptapContent } from '@/types'

interface MaterialCreationDialogProps {
  materialKey?: string
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
export function MaterialCreationDialog(props: MaterialCreationDialogProps) {
  return props.isOpen ? <MaterialEditor key={props.materialKey} {...props} /> : null
}

function MaterialEditor({
  isOpen, isExisting = false, isDraft = true, readOnly = false, saving = false,
  error, title, content, onTitleChange, onContentChange, onSave, onClose, onDelete,
}: MaterialCreationDialogProps) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [saveAsDraft, setSaveAsDraft] = useState(false)
  const disabled = saving || readOnly
  const markdown = useMaterialMarkdownDraft(content, disabled)
  const markdownSourceRef = useRef<HTMLTextAreaElement>(null)
  const saveDisabled = disabled || markdown.dirty
  const publishLabel = isDraft ? 'Post' : 'Save'

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
                disabled={saveDisabled}
                interactionActive={!previewOpen}
                exitMotion="opacity"
                toggleAriaLabel="Choose material action"
                menuPlacement="down"
                primaryButtonProps={{ className: 'min-w-24 justify-center font-semibold' }}
                onPrimaryClick={() => { if (!saveDisabled) onSave(saveAsDraft) }}
                options={[
                  { id: saveAsDraft ? 'post' : 'draft', label: saveAsDraft ? publishLabel : 'Save draft', onSelect: () => setSaveAsDraft(!saveAsDraft) },
                  ...(onDelete && !readOnly ? [{ id: 'delete', label: 'Delete material', destructive: true, onSelect: onDelete }] : []),
                ]}
              />
            )}
          />
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <SegmentedControl
              ariaLabel="Material editor mode"
              value={markdown.mode}
              onChange={markdown.changeMode}
              options={[
                { value: 'visual', label: 'Visual', disabled: saving || markdown.dirty },
                { value: 'markdown', label: 'Markdown', disabled: saving },
              ]}
            />
            {markdown.dirty && <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" disabled={saving} onClick={() => { markdown.reset(); markdownSourceRef.current?.focus() }}>Discard Markdown</Button>
              <Button disabled={!markdown.canApply} onClick={() => { markdown.apply(onContentChange); markdownSourceRef.current?.focus() }}>Apply Markdown</Button>
            </div>}
          </div>
          {markdown.dirty && <p role="status" className="text-sm text-warning">Markdown edits not applied</p>}
          {markdown.applied && <p role="status" className="text-sm text-success">Markdown applied to editor. Save or post to update the material.</p>}
          {markdown.mode === 'markdown' && markdown.warnings.length > 0 && <div className="shrink-0 rounded-md border border-warning bg-warning-bg p-3 text-sm text-warning">
            <p>{markdown.warnings.join(' ')} Applying Markdown replaces the current rich content. Review the preview first.</p>
            {markdown.dirty && <label className="mt-2 flex min-h-control cursor-pointer items-center gap-2">
              <input type="checkbox" className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" checked={markdown.acknowledged} disabled={disabled} onChange={(event) => markdown.setAcknowledged(event.target.checked)} />
              Apply with simplified formatting
            </label>}
          </div>}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {markdown.mode === 'markdown' ? <FormField label="Material Markdown" className="flex h-full min-h-64 flex-col">
              <textarea
                ref={markdownSourceRef}
                value={markdown.markdown}
                readOnly={disabled}
                onChange={(event) => markdown.changeMarkdown(event.target.value)}
                spellCheck={false}
                className="min-h-64 w-full flex-1 rounded-control border border-border-strong bg-surface p-3 font-mono text-sm text-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </FormField> : (
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
            )}
          </div>
          {error && <p role="alert" className="shrink-0 text-sm text-danger">{error}</p>}
        </div>
      </CreationModalShell>
      <ContentDialog isOpen={isOpen && previewOpen} onClose={() => setPreviewOpen(false)} title="Material preview" maxWidth="!max-w-2xl">
        <div className="mb-4">
          <p className="text-sm font-medium text-text-muted">Material</p>
          <h2 className="mt-1 text-2xl font-semibold text-text-default">{title.trim() || 'Untitled material'}</h2>
        </div>
        {markdown.dirty ? <div className="grid gap-4 sm:grid-cols-2">
          <section aria-label="Current material content"><h3 className="mb-2 text-sm font-semibold">Current</h3><RichTextViewer content={content} /></section>
          <section aria-label="Proposed material content"><h3 className="mb-2 text-sm font-semibold">Proposed</h3><RichTextViewer content={markdown.previewContent} /></section>
        </div> : <RichTextViewer content={content} />}
      </ContentDialog>
    </>
  )
}
