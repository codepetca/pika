'use client'

import { PalAchievements } from '@codepet/pal-widget'

import { PalFailureBoundary, PalWidgetThemeBoundary } from '@/integrations/pal'
import { PageState } from '@/ui'

export function StudentAchievementsTab({ scopeKey }: { scopeKey: string }) {
  return (
    <PalFailureBoundary
      fallback={(
        <PageState
          kind="error"
          title="Achievements are temporarily unavailable"
          description="Your Pika work is safe. Try loading the roadmap again."
          compact
        />
      )}
      resetKey={`${scopeKey}:achievements`}
    >
      <PalWidgetThemeBoundary className="min-h-0 flex-1">
        <PalAchievements />
      </PalWidgetThemeBoundary>
    </PalFailureBoundary>
  )
}
