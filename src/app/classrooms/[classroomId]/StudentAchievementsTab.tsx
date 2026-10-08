'use client'

import { PalAchievements } from '@codepet/pal-widget'
import { useRef, useState, type ReactNode } from 'react'

import { PalFailureBoundary, PalWidgetThemeBoundary } from '@/integrations/pal'
import { Button, PageState } from '@/ui'

export function StudentAchievementsRecovery({ children }: { children: ReactNode }) {
  const regionRef = useRef<HTMLDivElement>(null)
  const [retryGeneration, setRetryGeneration] = useState(0)

  const retry = () => {
    // Move focus before the boundary removes the initiating control.
    regionRef.current?.focus({ preventScroll: true })
    setRetryGeneration((generation) => generation + 1)
  }

  return (
    <div
      ref={regionRef}
      role="region"
      aria-label="Achievements"
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col outline-none focus-visible:ring-foundation focus-visible:ring-focus focus-visible:ring-offset-foundation focus-visible:ring-offset-surface"
    >
      <PalFailureBoundary
        fallback={(
          <PageState
            kind="error"
            title="Achievements are temporarily unavailable"
            description="Try again to load your roadmap."
            action={<Button type="button" variant="secondary" onClick={retry}>Try again</Button>}
            compact
          />
        )}
        resetKey={`achievements:${retryGeneration}`}
      >
        <PalWidgetThemeBoundary className="min-h-0 flex-1">
          {children}
        </PalWidgetThemeBoundary>
      </PalFailureBoundary>
    </div>
  )
}

export function StudentAchievementsTab() {
  return <StudentAchievementsRecovery><PalAchievements /></StudentAchievementsRecovery>
}
