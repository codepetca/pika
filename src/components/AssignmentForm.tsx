'use client'

import type { ReactNode, RefObject } from 'react'
import { Button } from '@/ui'
import { ContentField, MarkdownContentEditor } from '@/components/editor'
import {
  ClassworkModalTopLine,
  ClassworkModalTopLineField,
} from '@/components/classwork/ClassworkContentModal'
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
      <ClassworkModalTopLine
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
        meta={(
          (() => {
            const relative = getRelativeDueDate(dueAt, classDays)
            const labelText = relative ? `Due ${relative.text}` : 'Due Date'
            const tone = relative
              ? relative.isPast
                ? 'warning'
                : 'primary'
              : 'muted'

            return (
              <ClassworkModalTopLineField
                label={labelText}
                tone={tone}
                className="lg:w-[8.25rem]"
              >
              <DateActionBar
                value={dueAt}
                onChange={onDueAtChange}
                layout="compact"
                disabled={disabled}
              />
              </ClassworkModalTopLineField>
            )
          })()
        )}
        primaryActions={topRowActions}
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
