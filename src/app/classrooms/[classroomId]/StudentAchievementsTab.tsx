'use client'

import { PalAchievements } from '@codepet/pal-widget'

import { PalWidgetThemeBoundary } from '@/integrations/pal'

export function StudentAchievementsTab() {
  return (
    <PalWidgetThemeBoundary className="min-h-0 flex-1">
      <PalAchievements />
    </PalWidgetThemeBoundary>
  )
}
