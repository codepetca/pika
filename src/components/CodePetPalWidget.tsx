'use client'

import { useEffect, useRef, useState } from 'react'
import { Lock, X } from 'lucide-react'
import type { CodePetPalWorldView } from '@/lib/codepetpal'

interface CodePetPalWidgetProps {
  classroomId: string
  enabled: boolean
}

export function CodePetPalWidget({ classroomId, enabled }: CodePetPalWidgetProps) {
  const [view, setView] = useState<CodePetPalWorldView>({ enabled: false })
  const [panelOpen, setPanelOpen] = useState(false)
  const [reacting, setReacting] = useState(false)
  const longPressTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      setView({ enabled: false })
      return
    }

    let cancelled = false

    async function loadWorld() {
      try {
        const response = await fetch(`/api/integrations/codepetpal/world?classroom_id=${encodeURIComponent(classroomId)}`)
        const payload = await response.json()
        if (!cancelled) setView(payload)
      } catch {
        if (!cancelled) setView({ enabled: false })
      }
    }

    loadWorld()
    const intervalId = window.setInterval(loadWorld, 60_000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [classroomId, enabled])

  useEffect(() => {
    if (!reacting) return
    const timeout = window.setTimeout(() => setReacting(false), 900)
    return () => window.clearTimeout(timeout)
  }, [reacting])

  if (!enabled || !view.enabled) return null

  const petAsset = reacting ? view.world.pet.happy_asset_url : view.world.pet.idle_asset_url
  const xpProgressPercent = Math.max(0, Math.min(100, view.world.xp_progress_percent))

  function startLongPress() {
    clearLongPress()
    longPressTimer.current = window.setTimeout(() => setPanelOpen(true), 550)
  }

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
      {panelOpen && (
        <div className="w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-4 text-text-default shadow-elevated">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">CodePetPal</h2>
              <p className="text-xs text-text-muted">
                Level {view.world.level} · {view.world.xp} XP · {view.world.mood}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-default"
              aria-label="Close CodePetPal panel"
            >
              <X size={16} />
            </button>
          </div>

          <div className="mb-3 h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${xpProgressPercent}%` }}
              aria-hidden="true"
            />
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-border bg-surface-2 p-2">
              <span className="block text-text-muted">Streak</span>
              <strong>{view.world.streak_days} days</strong>
            </div>
            <div className="rounded-md border border-border bg-surface-2 p-2">
              <span className="block text-text-muted">Submissions</span>
              <strong>{view.world.assignment_submission_count}</strong>
            </div>
          </div>

          <p className="mb-3 text-sm text-text-muted">{view.next_nudge}</p>

          <div className="grid gap-2">
            <h3 className="text-xs font-semibold uppercase text-text-muted">Awards</h3>
            <div className="grid gap-2">
              {view.achievements.unlocked.slice(0, 4).map((achievement) => (
                <div key={achievement.key} className="flex items-center gap-2 rounded-md bg-surface-2 p-2">
                  <span
                    className="h-8 w-8 flex-none rounded-md border border-border bg-surface bg-contain bg-center bg-no-repeat"
                    style={{ backgroundImage: achievement.asset_url ? `url(${achievement.asset_url})` : undefined }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{achievement.title}</div>
                    <div className="truncate text-xs text-text-muted">{achievement.description}</div>
                  </div>
                </div>
              ))}
              {view.achievements.unlocked.length === 0 && (
                <div className="rounded-md bg-surface-2 p-2 text-sm text-text-muted">No awards yet</div>
              )}
              {view.achievements.locked.slice(0, 2).map((achievement) => (
                <div key={achievement.key} className="flex items-center gap-2 rounded-md bg-surface-2 p-2 opacity-70">
                  <span
                    className="grid h-8 w-8 flex-none place-items-center rounded-md border border-border bg-surface text-xs text-text-muted"
                    aria-hidden="true"
                  >
                    <Lock size={14} />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{achievement.title}</div>
                    <div className="truncate text-xs text-text-muted">Locked</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        aria-label="Open CodePetPal companion"
        aria-expanded={panelOpen}
        onClick={() => setReacting(true)}
        onContextMenu={(event) => {
          event.preventDefault()
          setPanelOpen(true)
        }}
        onPointerDown={startLongPress}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
        onPointerLeave={clearLongPress}
        onBlur={clearLongPress}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setPanelOpen((current) => !current)
          }
        }}
        className="grid h-16 w-16 place-items-center rounded-full border border-border bg-surface shadow-elevated transition hover:-translate-y-0.5 hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <span
          className="h-12 w-12 bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${petAsset})` }}
          aria-hidden="true"
        />
      </button>
    </div>
  )
}
