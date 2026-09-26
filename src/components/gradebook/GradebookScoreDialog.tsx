'use client'

import type { MaximumChangeMode } from '@/lib/gradebook-maximum'

import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { GradebookStudentSummary } from '@/types'
import { Button, ContentDialog, FormField, IconButton, Input, Select, cn } from '@/ui'
import { GRADEBOOK_NUMBER_INPUT_CLASS, getStudentName } from '@/lib/gradebook-display'

export function GradebookScoreDialog({
  isOpen,
  student,
  target,
  isSaving,
  error,
  onClose,
  onSave,
  onUndo,
  onClear,
}: {
  isOpen: boolean
  student: GradebookStudentSummary | null
  target: {
    kind: 'assessment' | 'item' | 'final' | 'maximum'
    title: string
    value: number | null
    possible?: number
    isOverride?: boolean
    undoValue?: number | null
  } | null
  isSaving: boolean
  error?: string
  onClose: () => void
  onSave: (earned: number, mode?: MaximumChangeMode) => void | Promise<void>
  onClear?: () => void | Promise<void>
  onUndo?: () => boolean | void | Promise<boolean | void>
}) {
  const [maximumMode, setMaximumMode] = useState<MaximumChangeMode>('keep_marks')
  const [value, setValue] = useState('')
  const [showUndo, setShowUndo] = useState(false)
  const [overrideUndone, setOverrideUndone] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    // Manual inputs use tenths; fractional derived marks stay exact until Save.
    setValue(target?.value == null ? '' : String(target.kind === 'maximum' ? target.value : Math.round(target.value * 10) / 10))
    setShowUndo(Boolean(target?.isOverride))
    setOverrideUndone(false)
    setMaximumMode('keep_marks')
  }, [isOpen, target?.isOverride, target?.title, target?.value])

  const isMaximum = target?.kind === 'maximum'
  const fieldLabel = isMaximum ? 'Max mark' : target?.kind === 'final' ? 'Final mark' : 'Mark earned'
  const earned = Number(value)
  const isTenth = Math.abs(earned * 10 - Math.round(earned * 10)) < 0.000001
  const isValid = value.trim() !== '' && Number.isFinite(earned) && (isMaximum ? earned > 0 : earned >= 0) && earned <= 999999.9 && isTenth
  const undoValueText = target?.undoValue == null ? '' : String(isMaximum ? target.undoValue : Math.round(target.undoValue * 10) / 10)
  const isRestoredValue = overrideUndone && value === undoValueText
  const possible = target?.kind !== 'final' && !isMaximum ? target?.possible : undefined
  const exceedsTotal = possible != null
    && isValid
    && earned > possible
  const excess = exceedsTotal ? Number((earned - possible).toFixed(1)) : 0

  return (
    <ContentDialog
      isOpen={isOpen}
      onClose={isSaving ? () => {} : onClose}
      title={isMaximum ? 'Edit max mark' : 'Edit mark'}
      subtitle={isMaximum ? target?.title : student && target ? `${getStudentName(student)} · ${target.title}` : undefined}
      maxWidth="max-w-xs"
      showFooterClose={false}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (isValid && !isSaving && !isRestoredValue) {
            if (isMaximum) void onSave(earned, maximumMode)
            else void onSave(earned)
          }
        }}
      >
        <FormField label={fieldLabel} error={value.trim() !== '' && !isValid ? (isMaximum ? 'Enter a positive number in increments of 0.1.' : 'Enter zero or a positive number in increments of 0.1.') : undefined}>
          <div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={isMaximum ? 0.1 : 0}
                max={999999.9}
                step="0.1"
                inputMode="decimal"
                aria-label={fieldLabel}
                value={value}
                disabled={isSaving}
                aria-invalid={value.trim() !== '' && !isValid}
                aria-describedby={exceedsTotal ? 'gradebook-mark-exceeds-total' : undefined}
                className={cn('w-24 flex-none text-right tabular-nums', GRADEBOOK_NUMBER_INPUT_CLASS)}
                onChange={(event) => setValue(event.target.value)}
              />
              {!isMaximum ? <span className="shrink-0 text-sm font-medium tabular-nums text-text-muted">
                {target?.kind === 'final' ? '%' : `/ ${target?.possible ?? '—'}`}
              </span> : null}
              {showUndo && onUndo ? (
                <span className="inline-flex items-center gap-1">
                  <IconButton icon={RotateCcw} label="Undo override" variant="ghost" loading={isSaving} onClick={async () => {
                    const undone = await onUndo()
                    if (undone === false) return
                    setValue(undoValueText)
                    setShowUndo(false)
                    setOverrideUndone(true)
                  }} />
                  <span
                    className="text-xs tabular-nums text-text-muted"
                    aria-label={`Mark after undo: ${target?.undoValue == null ? 'No mark' : `${target.undoValue}${target.kind === 'final' ? '%' : ''}`}`}
                  >
                    {target?.undoValue == null ? '—' : `${target.undoValue}${target.kind === 'final' ? '%' : ''}`}
                  </span>
                </span>
              ) : null}
            </div>
            {exceedsTotal ? (
              <p id="gradebook-mark-exceeds-total" role="status" className="mt-2 text-xs text-warning">
                This mark is {excess} {excess === 1 ? 'point' : 'points'} over the total of {possible}.
              </p>
            ) : null}
          </div>
        </FormField>
        {isMaximum ? <FormField label="Existing marks">
          <Select value={maximumMode} disabled={isSaving} options={[
            { value: 'keep_marks', label: 'Keep existing marks' },
            { value: 'preserve_percentages', label: 'Preserve percentages' },
          ]} onChange={(event) => setMaximumMode(event.target.value as MaximumChangeMode)} />
        </FormField> : null}
        {error ? <div role="alert" className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div> : null}
        <div className="flex flex-wrap justify-end gap-2">
          {target?.kind === 'item' && target.value != null && onClear ? <Button type="button" variant="secondary" disabled={isSaving} className="mr-auto" onClick={() => { void onClear() }}>Clear mark</Button> : null}
          <Button type="button" variant="secondary" disabled={isSaving} onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={isSaving} disabled={!isValid || isRestoredValue}>{isMaximum ? 'Save max mark' : 'Save mark'}</Button>
        </div>
      </form>
    </ContentDialog>
  )
}
