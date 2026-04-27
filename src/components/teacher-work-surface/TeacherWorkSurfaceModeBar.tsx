'use client'

import type { KeyboardEvent, ReactNode } from 'react'
import { useId } from 'react'

export interface TeacherWorkSurfaceMode<TMode extends string = string> {
  id: TMode
  label: ReactNode
  disabled?: boolean
}

interface TeacherWorkSurfaceModeBarProps<TMode extends string = string> {
  modes: readonly TeacherWorkSurfaceMode<TMode>[]
  activeMode: TMode
  onModeChange: (mode: TMode) => void
  center?: ReactNode
  trailing?: ReactNode
  status?: ReactNode
  ariaLabel?: string
}

export function TeacherWorkSurfaceModeBar<TMode extends string = string>({
  modes,
  activeMode,
  onModeChange,
  center,
  trailing,
  status,
  ariaLabel = 'Workspace modes',
}: TeacherWorkSurfaceModeBarProps<TMode>) {
  const tabListId = useId()

  const getTabId = (modeId: TMode) => `${tabListId}-${modeId}`

  const selectMode = (mode: TeacherWorkSurfaceMode<TMode>) => {
    if (mode.disabled) return
    onModeChange(mode.id)
  }

  const moveToMode = (mode: TeacherWorkSurfaceMode<TMode>) => {
    if (mode.disabled) return

    document.getElementById(getTabId(mode.id))?.focus()
    onModeChange(mode.id)
  }

  const findEnabledMode = (startIndex: number, direction: 1 | -1) => {
    if (modes.length === 0) return null

    for (let offset = 1; offset <= modes.length; offset += 1) {
      const candidate = modes[(startIndex + offset * direction + modes.length) % modes.length]
      if (candidate && !candidate.disabled) return candidate
    }

    return null
  }

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const enabledModes = modes.filter((mode) => !mode.disabled)
    if (enabledModes.length === 0) return

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      const nextMode = findEnabledMode(index, 1)
      if (nextMode) moveToMode(nextMode)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      const nextMode = findEnabledMode(index, -1)
      if (nextMode) moveToMode(nextMode)
    } else if (event.key === 'Home') {
      event.preventDefault()
      const firstMode = enabledModes[0]
      if (firstMode) moveToMode(firstMode)
    } else if (event.key === 'End') {
      event.preventDefault()
      const lastMode = enabledModes[enabledModes.length - 1]
      if (lastMode) moveToMode(lastMode)
    }
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:min-h-[2.75rem]">
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="mb-[-1px] flex items-end gap-1 self-end"
      >
        {modes.map((mode, index) => {
          const isActive = mode.id === activeMode
          return (
            <button
              key={mode.id}
              id={getTabId(mode.id)}
              type="button"
              role="tab"
              className={[
                isActive
                  ? 'relative z-10 rounded-t-lg border border-border border-b-surface bg-surface text-text-default'
                  : 'rounded-t-lg border border-transparent bg-surface-2 text-text-muted hover:bg-surface-hover hover:text-text-default',
                mode.disabled ? 'cursor-not-allowed opacity-50 hover:bg-surface-2 hover:text-text-muted' : '',
                'min-h-10 px-3 py-2 text-sm font-medium transition-colors',
              ].join(' ')}
              onClick={() => selectMode(mode)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              aria-selected={isActive}
              aria-disabled={mode.disabled || undefined}
              tabIndex={isActive && !mode.disabled ? 0 : -1}
              disabled={mode.disabled}
            >
              {mode.label}
            </button>
          )
        })}
      </div>

      <div className="flex min-w-0 basis-full justify-center sm:basis-auto sm:flex-1">
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-2 sm:gap-3">
          {center}
          {status}
        </div>
      </div>

      {trailing ? (
        <div className="flex flex-wrap items-center gap-1 sm:ml-auto sm:gap-2">
          {trailing}
        </div>
      ) : null}
    </div>
  )
}
