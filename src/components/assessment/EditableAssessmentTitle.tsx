'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { getDisplayAssessmentTitle } from '@/lib/assessment-titles'
import { Input, cn } from '@/ui'

interface EditableAssessmentTitleProps {
  title: string
  inputLabel: string
  editLabel: string
  disabled?: boolean
  saving?: boolean
  error?: string
  trailing?: ReactNode
  className?: string
  rowClassName?: string
  inputClassName?: string
  buttonClassName?: string
  textClassName?: string
  errorClassName?: string
  generatedTitleLabel?: string
  autoEdit?: boolean
  onDraftChange?: (title: string) => void
  onSave: (title: string) => void | Promise<void>
  onCancel?: () => void
}

export function EditableAssessmentTitle({
  title,
  inputLabel,
  editLabel,
  disabled = false,
  saving = false,
  error,
  trailing,
  className,
  rowClassName,
  inputClassName,
  buttonClassName,
  textClassName,
  errorClassName,
  generatedTitleLabel = 'Untitled',
  autoEdit = false,
  onDraftChange,
  onSave,
  onCancel,
}: EditableAssessmentTitleProps) {
  const displayTitle = getDisplayAssessmentTitle(title, generatedTitleLabel)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(displayTitle)
  const inputRef = useRef<HTMLInputElement>(null)
  const autoEditConsumedRef = useRef(false)

  useEffect(() => {
    if (editing) return
    setDraftTitle(displayTitle)
  }, [displayTitle, editing])

  useEffect(() => {
    if (!autoEdit) {
      autoEditConsumedRef.current = false
      return
    }
    if (autoEditConsumedRef.current || disabled || saving) return
    autoEditConsumedRef.current = true
    setDraftTitle(displayTitle)
    setEditing(true)
  }, [autoEdit, disabled, displayTitle, saving])

  useEffect(() => {
    if (!editing) return
    window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
  }, [editing])

  function startEditing() {
    if (disabled || saving) return
    setDraftTitle(displayTitle)
    setEditing(true)
  }

  function cancelEditing() {
    setDraftTitle(displayTitle)
    setEditing(false)
    onCancel?.()
  }

  async function saveDraft() {
    const cleanTitle = draftTitle.trim()
    if (!cleanTitle) {
      cancelEditing()
      return
    }

    await onSave(cleanTitle)
    setEditing(false)
  }

  return (
    <div className={cn('min-w-0', className)}>
      <div className={cn('flex min-w-0 flex-wrap items-center gap-2', rowClassName)}>
        {editing ? (
          <Input
            ref={inputRef}
            aria-label={inputLabel}
            value={draftTitle}
            onChange={(event) => {
              const nextTitle = event.target.value
              setDraftTitle(nextTitle)
              onDraftChange?.(nextTitle)
            }}
            onBlur={() => {
              void saveDraft()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void saveDraft()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                cancelEditing()
              }
            }}
            disabled={disabled || saving}
            className={cn('h-10 min-w-[14rem] max-w-full px-2 py-1 text-xl font-semibold', inputClassName)}
          />
        ) : (
          <button
            type="button"
            aria-label={editLabel}
            title={editLabel}
            disabled={disabled || saving}
            onClick={startEditing}
            className={cn(
              'group -mx-2 -my-1 flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left font-semibold text-text-default hover:bg-surface-hover disabled:cursor-default disabled:hover:bg-transparent',
              buttonClassName
            )}
          >
            <span className={cn('min-w-0 truncate text-xl', textClassName)}>{displayTitle}</span>
            <Pencil
              className="h-4 w-4 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              aria-hidden="true"
            />
          </button>
        )}
        {trailing}
      </div>
      {error ? (
        <p className={cn('mt-2 text-sm text-danger', errorClassName)}>{error}</p>
      ) : null}
    </div>
  )
}
