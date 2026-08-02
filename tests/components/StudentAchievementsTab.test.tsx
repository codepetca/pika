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
        <StudentAchievementsTab scopeKey="test-learner-generation" />
      </PalProvider>,
    )

    expect(screen.getByRole('heading', { name: 'Your achievement path' })).toBeVisible()
    expect(document.querySelector('iframe')).toBeNull()
    expect(document.querySelector('[data-pika-pal-theme-contract="1"]')).not.toBeNull()
  })
})
