import {
  PalProvider,
  createFixtureSnapshot,
  type PalClient,
} from '@codepet/pal-widget'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StudentAchievementsTab } from '@/app/classrooms/[classroomId]/StudentAchievementsTab'

describe('StudentAchievementsTab', () => {
  it('uses concise earned labels while retaining unfinished progress and status', () => {
    const snapshot = createFixtureSnapshot()
    snapshot.roadmap.weeks[0].achievements.push({
      id: 'joined-class',
      key: 'joined-class',
      title: 'Joined the Class',
      description: 'Joined a new classroom.',
      status: 'earned',
      statusLabel: 'Earned',
      badge: { label: 'Joined the Class', icon: 'classroom' },
    })
    snapshot.roadmap.weeks[1].achievements[0].status = 'incomplete'
    snapshot.roadmap.weeks[1].achievements[0].progress = {
      current: 1, target: 4, label: '1 of 4 eligible days',
    }
    const client: PalClient = {
      getSnapshot: async () => snapshot,
      markRewardSeen: async () => undefined,
    }

    render(
      <PalProvider client={client} initialSnapshot={snapshot} scopeKey="badge-labels">
        <StudentAchievementsTab />
      </PalProvider>,
    )

    for (const title of ['Joined the Class', 'First Pika Login', 'Weekly Rhythm']) {
      const badges = screen.getAllByRole('img', { name: title, exact: true })
      for (const badge of badges) {
        expect(badge).toHaveAttribute('data-achievement-result', 'earned')
        expect(badge).toHaveAttribute('tabindex', '0')
        expect(within(badge).getByText(title)).toHaveAttribute('aria-hidden', 'true')
      }
    }
    expect(screen.getByRole('img', { name: 'Weekly Rhythm — 2 of 4 eligible days' }))
      .toHaveTextContent('2/4')
    expect(screen.getByRole('img', { name: 'Weekly Rhythm — Not completed (1 of 4 eligible days)' }))
      .toHaveAttribute('data-achievement-result', 'not-earned')
    expect(screen.queryByRole('img', { name: /— Earned/ })).toBeNull()
  })

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
