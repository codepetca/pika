import {
  PalProvider,
  createFixtureSnapshot,
  type PalClient,
} from '@codepet/pal-widget'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StudentAchievementsTab } from '@/app/classrooms/[classroomId]/StudentAchievementsTab'

describe('StudentAchievementsTab', () => {
  it('renders the native Pal roadmap in Pika content instead of an iframe', () => {
    const snapshot = createFixtureSnapshot()
    const client: PalClient = {
      getSnapshot: async () => snapshot,
      markRewardSeen: async () => undefined,
    }

    render(
      <PalProvider
        client={client}
        initialSnapshot={snapshot}
        scopeKey="test-learner-generation"
      >
        <StudentAchievementsTab />
      </PalProvider>,
    )

    expect(screen.getByRole('region', { name: 'Achievement trail' })).toBeVisible()
    expect(document.querySelector('iframe')).toBeNull()
    expect(document.querySelector('[data-pika-pal-theme-contract="1"]')).not.toBeNull()
  })

  it('renders Pal-owned weekly collectible finish presentation without host inference', () => {
    const snapshot = createFixtureSnapshot()
    if (!snapshot.progression) throw new Error('Published Pal fixture omitted progression')
    snapshot.progression.collectibles = snapshot.progression.collectibles.map((collectible) => (
      collectible.roadmapWeek === snapshot.roadmap.currentWeek
        ? {
            id: 'story-week-4',
            roadmapWeek: snapshot.roadmap.currentWeek,
            status: 'earned' as const,
            statusLabel: 'Storybook sketch',
            chapterId: 'chapter-4',
            title: 'The Clockwork Lantern',
            description: 'A weekly story keepsake.',
            kind: 'room' as const,
            finish: 'sketch' as const,
            assetUrl: 'https://pal.example.test/assets/clockwork-lantern.png',
          }
        : collectible
    ))
    const client: PalClient = {
      getSnapshot: async () => snapshot,
      markRewardSeen: async () => undefined,
    }

    render(
      <PalProvider
        client={client}
        initialSnapshot={snapshot}
        scopeKey="test-story-learner-generation"
      >
        <StudentAchievementsTab />
      </PalProvider>,
    )

    expect(screen.getByRole('img', {
      name: 'Week 4 collectible: The Clockwork Lantern, storybook sketch',
    })).toHaveAttribute('data-collectible-finish', 'sketch')
  })
})
