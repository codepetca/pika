'use client'

import { useMemo, useState } from 'react'
import { Sparkles, X, Check, PawPrint } from 'lucide-react'
import { useWorldOverlay } from './WorldOverlayProvider'

export function WorldOverlay() {
  const { snapshot, loading, error, toggleOverlay, claimDaily } = useWorldOverlay()
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const world = snapshot?.world
  const daily = snapshot?.dailyEvent

  const canRender = Boolean(world) && world?.overlay_enabled !== false && !dismissed
  const canClaim = daily?.status === 'claimable'

  const tierLabel = useMemo(() => {
    const tier = snapshot?.latestWeeklyResult?.tier
    if (!tier) return null
    if (tier === 'special') return 'Special Week'
    if (tier === 'nicer') return 'Nicer Week'
    return 'Baseline Week'
  }, [snapshot?.latestWeeklyResult?.tier])

  if (!canRender) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 w-[280px] rounded-xl border border-border bg-surface/95 p-3 shadow-lg backdrop-blur-sm">
      <div className="pointer-events-auto flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary">
            <PawPrint className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-default">Pika World</p>
            <p className="text-xs text-text-muted">
              Level {world?.level ?? 0} . {world?.xp ?? 0} XP
            </p>
          </div>
        </div>
        <button
          type="button"
          className="rounded p-1 text-text-muted hover:bg-surface-hover"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss world overlay"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="pointer-events-auto mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2">
        {loading && <p className="text-xs text-text-muted">Loading daily world event...</p>}
        {!loading && error && <p className="text-xs text-danger">{error}</p>}
        {!loading && !error && (
          <>
            <p className="text-xs font-medium text-text-default">
              {daily?.event_key
                ? `Daily care: ${daily.event_key.replace(/^daily_/, '').replaceAll('_', ' ')}`
                : 'No daily event available right now'}
            </p>
            <p className="mt-1 text-[11px] text-text-muted">
              {canClaim
                ? 'Claim this daily care action before midnight (Toronto).'
                : daily?.status === 'claimed'
                ? 'Daily event completed.'
                : 'Daily event unavailable.'}
            </p>
          </>
        )}
      </div>

      <div className="pointer-events-auto mt-3 flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-text-inverse hover:bg-primary-hover disabled:opacity-50"
          disabled={!canClaim || busy}
          onClick={async () => {
            setBusy(true)
            try {
              await claimDaily()
            } finally {
              setBusy(false)
            }
          }}
        >
          <Check className="h-3.5 w-3.5" />
          {busy ? 'Claiming...' : 'Claim'}
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs text-text-muted hover:bg-surface-hover"
          onClick={async () => {
            setBusy(true)
            try {
              await toggleOverlay(false)
              setDismissed(true)
            } finally {
              setBusy(false)
            }
          }}
          disabled={busy}
        >
          Hide Overlay
        </button>
        {tierLabel && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-text-muted">
            <Sparkles className="h-3.5 w-3.5 text-warning" />
            {tierLabel}
          </span>
        )}
      </div>
    </div>
  )
}

