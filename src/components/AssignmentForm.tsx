'use client'

import { useEffect, useState, type ReactNode, type RefObject } from 'react'
import { Eye } from 'lucide-react'
import { Button, FormField, IconButton, Input } from '@/ui'
import { MarkdownAuthoringEditor } from '@/components/editor'
import { CreationModalContextHeader, CreationModalTopRow } from '@/components/creation/CreationModalShell'
import { DateActionBar } from '@/components/DateActionBar'
import { uploadMarkdownImage } from '@/lib/markdown-image-upload'
import { getRelativeDueDate } from '@/lib/assignment-relative-date'
import type { ClassDay } from '@/types'

interface AssignmentFormProps {
  classroomId?: string
  classroomName?: string
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
  /** Retire live editor controls while preserving outgoing field presentation. */
  interactionActive?: boolean
  error?: string
  titleInputRef?: RefObject<HTMLInputElement>
  onBlur?: () => void
  settingsAction?: ReactNode
  topRowActions?: ReactNode
  statusContent?: ReactNode
  saveStatusContent?: ReactNode
  markdownWarning?: string | null
  fillHeight?: boolean
  desktopSplit?: boolean
}

export function AssignmentForm({
  classroomId,
  classroomName,
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
  interactionActive = true,
  error,
  titleInputRef,
  onBlur,
  settingsAction,
  topRowActions,
  statusContent,
  saveStatusContent,
  markdownWarning,
  fillHeight = false,
  desktopSplit = false,
}: AssignmentFormProps) {
  const [mode, setMode] = useState(instructionsMode)
  useEffect(() => { setMode(instructionsMode) }, [instructionsMode])
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
      <MarkdownAuthoringEditor
        label="Instructions"
        mode={mode}
        onModeChange={setMode}
        markdown={instructionsMarkdown}
        onMarkdownChange={onInstructionsMarkdownChange}
        onConversionWarningChange={onInstructionsConversionWarningChange}
        onBlur={onBlur}
        placeholder="Instructions"
        disabled={disabled}
        editable={!disabled}
        interactionActive={interactionActive}
        fillHeight={fillHeight}
        statusContent={saveStatusContent}
        imageUpload={classroomId ? (file, signal) => uploadMarkdownImage(classroomId, file, signal) : undefined}
        className="rounded-control border border-border-strong"
      />
    </>
  )

  if (desktopSplit) {
    return (
      <div
        data-testid="assignment-editor-split"
        className="grid h-full min-h-0 w-full auto-rows-max grid-cols-1 overflow-y-auto lg:grid-cols-3 lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden"
      >
        <CreationModalContextHeader itemType="Assignment" classroomName={classroomName} spacious />
        <div
          data-testid="assignment-editor-details-pane"
          className="flex min-w-0 flex-col gap-4 bg-surface-2 p-3 sm:p-4 lg:col-start-1 lg:row-start-2 lg:min-h-0 lg:overflow-y-auto"
        >
          <FormField
            className="modal-title-field"
            label="Title"
            required
            hideLabel
            collapseHiddenLabel
          >
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

          {statusContent}
          {extraFields}
          {error && <p className="text-sm text-warning">{error}</p>}

          <div className="mt-auto space-y-2">
            <div className={settingsAction ? 'grid grid-cols-2 gap-2' : undefined}>
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
              {settingsAction}
            </div>

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
        </div>

        <div
          data-testid="assignment-editor-content-pane"
          className="flex min-h-96 flex-col p-3 sm:p-4 lg:col-span-2 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:min-h-0 lg:overflow-hidden"
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
