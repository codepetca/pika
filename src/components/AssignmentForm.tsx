'use client'

import type { ReactNode, RefObject } from 'react'
import { Eye } from 'lucide-react'
import { IconButton } from '@/ui'
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
  const relativeDueDate = getRelativeDueDate(dueAt, classDays)
  const relativeDateSubtitle = relativeDueDate
    ? `${relativeDueDate.text.charAt(0).toUpperCase()}${relativeDueDate.text.slice(1)}`
    : null

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
            {markdownWarning && (
              <div className="mb-2 rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
                {markdownWarning}
              </div>
            )}
            <ContentField
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
            </ContentField>
          </div>
        </div>
      </div>

      {error && <p className="shrink-0 text-sm text-warning">{error}</p>}
    </div>
  )
}
