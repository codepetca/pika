'use client'

import type { ReactNode, RefObject } from 'react'
import { Eye } from 'lucide-react'
import { Button, FormField, IconButton, Input } from '@/ui'
import { ContentField, MarkdownContentEditor } from '@/components/editor'
import { CreationModalTopRow } from '@/components/creation/CreationModalShell'
import { DateActionBar } from '@/components/DateActionBar'
import { getRelativeDueDate } from '@/lib/assignment-relative-date'
import type { ClassDay } from '@/types'

interface AssignmentFormProps {
  title: string
  instructionsMarkdown: string
  instructionsMode?: 'visual' | 'markdown'
  dueAt: string
  classDays?: ClassDay[]
  extraFields?: ReactNode
  onTitleChange: (next: string) => void
  onInstructionsMarkdownChange: (next: string) => void
  onInstructionsConversionWarningChange?: (warning: string | null) => void
  onDueAtChange: (next: string) => void
  onPreviewInstructions?: () => void
  disabled?: boolean
  error?: string
  titleInputRef?: RefObject<HTMLInputElement>
  onBlur?: () => void
  topRowActions?: ReactNode
  statusContent?: ReactNode
  markdownWarning?: string | null
  fillHeight?: boolean
  desktopSplit?: boolean
}

export function AssignmentForm({
  title,
  instructionsMarkdown,
  instructionsMode = 'visual',
  dueAt,
  classDays,
  extraFields,
  onTitleChange,
  onInstructionsMarkdownChange,
  onInstructionsConversionWarningChange,
  onDueAtChange,
  onPreviewInstructions,
  disabled = false,
  error,
  titleInputRef,
  onBlur,
  topRowActions,
  statusContent,
  markdownWarning,
  fillHeight = false,
  desktopSplit = false,
}: AssignmentFormProps) {
  const relativeDueDate = getRelativeDueDate(dueAt, classDays)
  const relativeDateSubtitle = relativeDueDate
    ? `${relativeDueDate.text.charAt(0).toUpperCase()}${relativeDueDate.text.slice(1)}`
    : null

  const editor = (
    <>
      {markdownWarning && (
        <div className="mb-2 rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
          {markdownWarning}
        </div>
      )}
      {instructionsMode === 'markdown' ? (
        <FormField label="Instructions Markdown" className={fillHeight ? 'flex min-h-0 flex-1 flex-col' : ''}>
          <textarea
            value={instructionsMarkdown}
            onChange={(event) => onInstructionsMarkdownChange(event.target.value)}
            onBlur={onBlur}
            disabled={disabled}
            spellCheck={false}
            rows={14}
            className="min-h-64 w-full flex-1 resize-y rounded-control border border-border bg-surface px-3 py-2 font-mono text-sm text-text-default focus-visible:outline-none focus-visible:ring-foundation focus-visible:ring-focus disabled:cursor-not-allowed disabled:bg-surface-2"
          />
        </FormField>
      ) : <ContentField
        label="Instructions"
        hideLabel
        collapseHiddenLabel
        className={fillHeight ? 'flex min-h-0 flex-1 flex-col' : ''}
      >
        <MarkdownContentEditor
          markdown={instructionsMarkdown}
          onMarkdownChange={onInstructionsMarkdownChange}
          onConversionWarningChange={onInstructionsConversionWarningChange}
          onBlur={onBlur}
          placeholder="Instructions"
          disabled={disabled}
          editable={!disabled}
          toolbarPreset="markdown-safe"
          className={[
            'overflow-hidden rounded-lg border border-border-strong',
            fillHeight ? 'simple-editor-wrapper--fill-height min-h-0 flex-1' : '',
          ].join(' ')}
        />
      </ContentField>}
    </>
  )

  if (desktopSplit) {
    return (
      <div
        data-testid="assignment-editor-split"
        className="grid h-full min-h-0 w-full overflow-y-auto lg:grid-cols-3 lg:overflow-hidden"
      >
        <div
          data-testid="assignment-editor-details-pane"
          className="flex flex-col gap-4 border-b border-border p-3 sm:p-4 lg:min-h-0 lg:overflow-y-auto lg:border-b-0"
        >
          <FormField label="Title" required hideLabel collapseHiddenLabel>
            <Input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              onBlur={onBlur}
              required
              disabled={disabled}
              placeholder="Title"
            />
          </FormField>

          {onPreviewInstructions && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              fullWidth
              className="shrink-0"
              onClick={onPreviewInstructions}
              disabled={disabled}
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              Preview
            </Button>
          )}

          {statusContent}
          {extraFields}
          {error && <p className="text-sm text-warning">{error}</p>}

          <div
            data-testid="assignment-editor-primary-actions"
            className={topRowActions
              ? 'grid shrink-0 grid-cols-2 gap-2 lg:mt-auto'
              : 'grid shrink-0 grid-cols-1 gap-2 lg:mt-auto'}
          >
            <DateActionBar
              value={dueAt}
              onChange={onDueAtChange}
              layout="compact"
              subtitle={relativeDateSubtitle}
              className="min-w-0 [&>div]:w-full [&_button]:w-full"
            />
            {topRowActions && (
              <div className="min-w-0 [&>*]:w-full">
                {topRowActions}
              </div>
            )}
          </div>
        </div>

        <div
          data-testid="assignment-editor-content-pane"
          className="flex min-h-96 flex-col p-3 sm:p-4 lg:col-span-2 lg:min-h-0 lg:overflow-hidden"
        >
          {editor}
        </div>
      </div>
    )
  }

  return (
    <div className={fillHeight ? 'flex h-full min-h-0 w-full flex-col gap-3' : 'space-y-3 w-full'}>
      <CreationModalTopRow
        title={title}
        titlePlaceholder="Title"
        hideTitleLabel
        titleDisabled={disabled}
        titleInputRef={titleInputRef}
        titleInputClassName="flex-1"
        titleFieldClassName="col-span-2 !max-w-none sm:col-span-1 sm:self-start sm:!max-w-[24rem]"
        className="shrink-0 grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(9rem,1fr)_auto_auto]"
        titleStatus={statusContent}
        onTitleChange={onTitleChange}
        onTitleBlur={onBlur}
        afterTitle={(
          <div className="flex items-end gap-2">
            {onPreviewInstructions && (
              <IconButton
                icon={Eye}
                label="Preview"
                variant="secondary"
                onClick={onPreviewInstructions}
                disabled={disabled}
              />
            )}
            <DateActionBar
              value={dueAt}
              onChange={onDueAtChange}
              layout="compact"
              subtitle={relativeDateSubtitle}
            />
          </div>
        )}
        actions={topRowActions}
      />

      <div className={fillHeight ? 'min-h-0 flex-1 overflow-y-auto' : ''}>
        <div className={fillHeight ? 'flex min-h-full flex-col gap-3' : 'space-y-3'}>
          {extraFields && <div className="shrink-0">{extraFields}</div>}

          <div className={fillHeight ? 'flex min-h-64 flex-1 flex-col' : ''}>
            {editor}
          </div>
        </div>
      </div>

      {error && <p className="shrink-0 text-sm text-warning">{error}</p>}
    </div>
  )
}
