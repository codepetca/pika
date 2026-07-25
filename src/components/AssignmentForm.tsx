'use client'

import type { ReactNode, RefObject } from 'react'
import { Eye } from 'lucide-react'
import { Button } from '@/ui'
import { ContentField, MarkdownContentEditor } from '@/components/editor'
import { CreationModalTopRow } from '@/components/creation/CreationModalShell'
import { DateActionBar } from '@/components/DateActionBar'
import { getRelativeDueDate } from '@/lib/assignment-relative-date'
import type { ClassDay } from '@/types'

interface AssignmentFormProps {
  title: string
  instructionsMarkdown: string
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
}

export function AssignmentForm({
  title,
  instructionsMarkdown,
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
}: AssignmentFormProps) {
  return (
    <div className={fillHeight ? 'flex h-full min-h-0 w-full flex-col gap-3' : 'space-y-3 w-full'}>
      <CreationModalTopRow
        title={title}
        titlePlaceholder="Add a title"
        titleDisabled={disabled}
        titleInputRef={titleInputRef}
        titleInputClassName="flex-1"
        titleFieldClassName="col-span-2 !max-w-none sm:col-span-1 sm:!max-w-[24rem]"
        className="grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(9rem,1fr)_auto_auto]"
        titleStatus={statusContent}
        onTitleChange={onTitleChange}
        onTitleBlur={onBlur}
        afterTitle={(
          <div className="flex items-end gap-2">
            {onPreviewInstructions && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onPreviewInstructions}
                disabled={disabled}
                className="h-9 w-9 px-0 sm:w-auto sm:px-3 sm:gap-1.5"
                aria-label="Preview"
              >
                <Eye className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Preview</span>
              </Button>
            )}
            <div className="w-[6.25rem] space-y-1 sm:w-[8.25rem]">
              {(() => {
                const relative = getRelativeDueDate(dueAt, classDays)
                const labelText = relative ? `Due ${relative.text}` : 'Due Date'
                const colorClass = relative
                  ? relative.isPast
                    ? 'text-warning'
                    : 'text-primary'
                  : 'text-text-muted'
                return (
                  <div className={`truncate text-sm font-medium ${colorClass}`}>
                    {labelText}
                  </div>
                )
              })()}
              <div className="flex">
                <DateActionBar
                  value={dueAt}
                  onChange={onDueAtChange}
                  layout="compact"
                />
              </div>
            </div>
          </div>
        )}
        actions={topRowActions}
      />

      {extraFields}

      <div className={fillHeight ? 'flex min-h-0 flex-1 flex-col' : ''}>
        {markdownWarning && (
          <div className="mb-2 rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
            {markdownWarning}
          </div>
        )}
        <ContentField
          label="Instructions"
          hint="Students see this before they begin."
          className={fillHeight ? 'flex min-h-0 flex-1 flex-col' : ''}
        >
          <MarkdownContentEditor
            markdown={instructionsMarkdown}
            onMarkdownChange={onInstructionsMarkdownChange}
            onConversionWarningChange={onInstructionsConversionWarningChange}
            onBlur={onBlur}
            placeholder="Assignment instructions"
            disabled={disabled}
            editable={!disabled}
            toolbarPreset="markdown-safe"
            className={[
              'overflow-hidden rounded-lg border border-border-strong',
              fillHeight ? 'simple-editor-wrapper--fill-height min-h-0 flex-1' : '',
            ].join(' ')}
          />
        </ContentField>
      </div>

      {error && <p className="text-sm text-warning">{error}</p>}
    </div>
  )
}
