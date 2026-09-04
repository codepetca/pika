'use client'

import { Check } from 'lucide-react'
import { cn } from '@/ui'

export interface OnboardingChecklistItem {
  id: string
  label: string
  done: boolean
}

export interface OnboardingChecklistProps {
  title: string
  items: OnboardingChecklistItem[]
  activeStepId: string | null
  open: boolean
  justCompleted: boolean
  onSelectItem: (id: string) => void
  onToggleOpen: () => void
}

/**
 * A getting-started checklist: a collapsed floating badge showing progress,
 * or an expanded panel listing steps. Purely presentational — completion
 * and navigation are owned by OnboardingChecklistProvider.
 */
export function OnboardingChecklist({
  title,
  items,
  activeStepId,
  open,
  justCompleted,
  onSelectItem,
  onToggleOpen,
}: OnboardingChecklistProps) {
  const doneCount = items.filter((item) => item.done).length
  const progress = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0

  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggleOpen}
        className="fixed bottom-5 right-5 z-popover inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface py-1.5 pl-2 pr-3.5 text-sm shadow-elevated hover:bg-surface-hover"
      >
        <ProgressRing progress={progress} />
        <span className="font-semibold text-text-default">{title}</span>
        <span className="text-xs text-text-muted">{doneCount}/{items.length}</span>
      </button>
    )
  }

  return (
    <div className="fixed bottom-5 right-5 z-popover w-72 rounded-card border border-border bg-surface p-3.5 shadow-elevated">
      <div className="mb-0.5 flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-text-default">{title}</h3>
        <button
          type="button"
          onClick={onToggleOpen}
          aria-label="Collapse checklist"
          className="rounded p-0.5 text-text-muted hover:text-text-default"
        >
          –
        </button>
      </div>

      {justCompleted ? (
        <p className="py-1.5 text-sm font-semibold text-success">All set — classroom is ready to go.</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-text-muted">{doneCount} of {items.length} done</p>
          <div className="mb-2.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-warning transition-[width] duration-standard ease-standard"
              style={{ width: `${progress}%` }}
            />
          </div>
          <ul className="space-y-0.5">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelectItem(item.id)}
                  disabled={item.done}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-control px-1.5 py-1.5 text-left text-sm',
                    item.done ? 'cursor-default text-text-muted line-through' : 'hover:bg-surface-hover',
                    activeStepId === item.id && !item.done ? 'bg-warning-bg' : '',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                      item.done ? 'border-success-solid bg-success-solid text-text-inverse' : 'border-border-strong',
                    )}
                  >
                    {item.done ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                  </span>
                  <span className="flex-1">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function ProgressRing({ progress }: { progress: number }) {
  const radius = 9
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (progress / 100) * circumference
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" className="shrink-0" aria-hidden="true">
      <circle cx="11" cy="11" r={radius} fill="none" stroke="var(--color-surface-2)" strokeWidth="3" />
      <circle
        cx="11"
        cy="11"
        r={radius}
        fill="none"
        stroke="var(--color-warning)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 11 11)"
      />
    </svg>
  )
}
