'use client'

import { FormField, SegmentedControl, cn } from '@/ui'
import { ContentField } from './ContentField'
import { MarkdownContentEditor, type MarkdownContentEditorProps } from './MarkdownContentEditor'

export type MarkdownAuthoringMode = 'visual' | 'markdown'

interface MarkdownAuthoringEditorProps extends Pick<MarkdownContentEditorProps,
  'markdown' | 'onMarkdownChange' | 'onConversionWarningChange' | 'onBlur' |
  'placeholder' | 'disabled' | 'editable' | 'interactionActive' | 'className'> {
  label: string
  mode: MarkdownAuthoringMode
  onModeChange: (mode: MarkdownAuthoringMode) => void
  fillHeight?: boolean
}

/** Both views edit the caller's Markdown draft; selecting a mode never serializes it. */
export function MarkdownAuthoringEditor({
  label, mode, onModeChange, markdown, onMarkdownChange, onConversionWarningChange,
  onBlur, placeholder, disabled = false, editable = true, interactionActive = true,
  className, fillHeight = false,
}: MarkdownAuthoringEditorProps) {
  const inactive = disabled || !editable || !interactionActive

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', fillHeight && 'min-h-0 flex-1')}>
      <div className="flex justify-end">
        <SegmentedControl
          ariaLabel={`${label} editing mode`}
          value={mode}
          onChange={(next) => { if (!inactive) onModeChange(next) }}
          options={[
            { value: 'visual', label: 'Write', disabled: inactive },
            { value: 'markdown', label: 'Markdown', disabled: inactive },
          ]}
        />
      </div>
      {mode === 'markdown' ? (
        <FormField label={`${label} Markdown`} hideLabel collapseHiddenLabel
          className={fillHeight ? 'flex min-h-0 flex-1 flex-col' : undefined}>
          <textarea
            value={markdown}
            onChange={(event) => { if (!inactive) onMarkdownChange(event.target.value) }}
            onBlur={() => { if (!inactive) onBlur?.() }}
            disabled={inactive}
            placeholder={placeholder}
            spellCheck={false}
            rows={14}
            className={cn('min-h-64 w-full resize-y rounded-control border border-border bg-surface px-3 py-3 font-mono text-sm text-text-default focus-visible:outline-none focus-visible:ring-foundation focus-visible:ring-focus disabled:cursor-not-allowed disabled:bg-surface-2',
              fillHeight && 'flex-1', className)}
          />
        </FormField>
      ) : (
        <ContentField label={label} hideLabel collapseHiddenLabel
          className={fillHeight ? 'flex min-h-0 flex-1 flex-col' : undefined}>
          <MarkdownContentEditor
            aria-label={label}
            markdown={markdown}
            onMarkdownChange={onMarkdownChange}
            onConversionWarningChange={onConversionWarningChange}
            onBlur={onBlur}
            placeholder={placeholder}
            disabled={disabled}
            editable={editable}
            interactionActive={interactionActive}
            toolbarPreset="markdown-authoring"
            className={cn(fillHeight && 'simple-editor-wrapper--fill-height min-h-0 flex-1', className)}
          />
        </ContentField>
      )}
    </div>
  )
}
