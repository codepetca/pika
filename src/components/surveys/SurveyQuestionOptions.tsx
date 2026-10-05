'use client'

import { useRef, useState } from 'react'
import { GripVertical, Trash2 } from 'lucide-react'
import { MAX_SURVEY_OPTIONS } from '@/lib/surveys'
import { Button, Input, Tooltip } from '@/ui'

interface SurveyQuestionOptionsProps {
  options: string[]
  disabled?: boolean
  labelPrefix?: string
  onChange: (options: string[]) => void
  onBlur?: () => void
}

/** Survey option editing shared by real authoring and its fixed-fixture reference. */
export function SurveyQuestionOptions({ options, disabled = false, labelPrefix = '', onChange, onBlur }: SurveyQuestionOptionsProps) {
  const [dragging, setDragging] = useState<number | null>(null)
  const handles = useRef<Array<HTMLButtonElement | null>>([])
  const rows = options.length < 2 ? [...options, ...Array<string>(2 - options.length).fill('')] : options.length < MAX_SURVEY_OPTIONS && options.at(-1)?.trim() ? [...options, ''] : options
  const filledCount = rows.filter((option) => option.trim()).length

  function move(from: number, to: number) {
    if (disabled || from === to || !rows[from]?.trim() || !rows[to]?.trim()) return
    const next = [...rows]
    const [option] = next.splice(from, 1)
    next.splice(to, 0, option)
    onChange(next)
  }

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-md bg-surface-2 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Answer options</p>
      {rows.map((option, index) => {
        const letter = index < 26 ? String.fromCharCode(65 + index) : String(index + 1)
        const blank = !option.trim()
        return (
          <div key={index} draggable={!disabled && !blank} onDragStart={() => setDragging(index)} onDragEnd={() => setDragging(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (dragging !== null) move(dragging, index); setDragging(null) }} className="flex items-center gap-2">
            <Tooltip content="Reorder option">
              <Button ref={(element) => { handles.current[index] = element }} variant="ghost" size="sm" aria-label={`Reorder option ${letter}; use Up and Down arrow keys`} aria-keyshortcuts="ArrowUp ArrowDown" disabled={disabled || blank} onKeyDown={(event) => {
                const next = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : index
                if (next === index || !rows[next]?.trim()) return
                event.preventDefault()
                move(index, next)
                window.requestAnimationFrame(() => handles.current[next]?.focus())
              }} className="h-11 w-11 shrink-0 cursor-grab p-0 text-text-muted"><GripVertical className="h-4 w-4" aria-hidden="true" /></Button>
            </Tooltip>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-sm text-text-muted" aria-hidden="true">{letter}</span>
            <Input value={option} aria-label={`${labelPrefix}${labelPrefix ? "option" : "Option"} ${letter}`} placeholder={`Option ${letter}`} disabled={disabled} onChange={(event) => onChange(rows.map((item, i) => i === index ? event.target.value : item))} onBlur={onBlur} />
            {blank ? <span className="h-11 w-11 shrink-0" aria-hidden="true" /> : (
              <Tooltip content="Delete option"><Button variant="ghost" size="sm" aria-label={`Delete option ${letter}`} disabled={disabled || filledCount <= 2} onClick={() => onChange(rows.filter((_, i) => i !== index))} className="h-11 w-11 shrink-0 p-0 text-text-muted"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button></Tooltip>
            )}
          </div>
        )
      })}
    </div>
  )
}
