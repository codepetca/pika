import {
  createFixtureSnapshot,
  type PalClient,
  type PalWidgetSnapshot,
} from '@codepet/pal-widget'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreatePikaPalClient } = vi.hoisted(() => ({
  mockCreatePikaPalClient: vi.fn(),
}))
const { mockUseSearchParams } = vi.hoisted(() => ({
  mockUseSearchParams: vi.fn(() => new URLSearchParams()),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: mockUseSearchParams,
}))

vi.mock('@/integrations/pal/pal-client', () => ({
  createPikaPalClient: mockCreatePikaPalClient,
}))

import { ThemeProvider } from '@/contexts/ThemeContext'
import {
  PalFailureBoundary,
  StudentPalExperience,
} from '@/integrations/pal/StudentPalExperience'
import { StudentAchievementsTab } from '@/app/classrooms/[classroomId]/StudentAchievementsTab'
import { PIKA_LOCATION_CHANGE_EVENT } from '@/lib/browser-navigation'
import { PIKA_PAL_REFRESH_EVENT } from '@/lib/pal-browser-events'

function withReward(): PalWidgetSnapshot {
  const snapshot = createFixtureSnapshot()
  snapshot.rewards = [{
    id: 'reward-1',
    title: 'A fish for Pip',
    description: 'Your steady work earned a snack.',
    icon: '🐟',
  }]
  return snapshot
}

function withStoryReward(): PalWidgetSnapshot {
  const snapshot = createFixtureSnapshot()
  snapshot.rewards = [{
    id: 'story-reward-1',
    kind: 'story',
    title: 'A new chapter',
    description: 'Pal awarded this week\'s guaranteed story keepsake.',
    collectibleTitle: 'The Clockwork Lantern',
    collectibleFinish: 'sketch',
    titleAward: 'Story Keeper',
    titleRevealCopy: 'A title chosen and awarded by Pal.',
    assetUrl: 'https://pal.example.test/assets/clockwork-lantern.png',
  }]
  return snapshot
}

function unlockCompanion(snapshot: PalWidgetSnapshot, assetName: string): void {
  if (!snapshot.progression) throw new Error('Published Pal fixture omitted progression')
  snapshot.progression.companionReveal = {
    status: 'earned',
    assetUrl: `https://pal.example.test/assets/${assetName}.png`,
  }
}

function renderExperience(
  client: PalClient,
  children: ReactNode = <div>Academic work remains available</div>,
  showAmbientSurfaces = true,
) {
  mockCreatePikaPalClient.mockReturnValue(client)
  return render(
    <ThemeProvider>
      <StudentPalExperience
        apiBaseUrl="https://pal.example.test"
        scopeKey="opaque-session-a"
        showAmbientSurfaces={showAmbientSurfaces}
      >
        {children}
      </StudentPalExperience>
    </ThemeProvider>,
  )
}

describe('StudentPalExperience', () => {
  beforeEach(() => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams())
    window.localStorage.clear()
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))
  })

  afterEach(() => {
    window.history.replaceState({}, '', '/')
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('mounts roadmap, companion, and one Pika-owned reward dialog', async () => {
    const snapshot = withReward()
    renderExperience({
      getSnapshot: async () => snapshot,
      markRewardSeen: async () => undefined,
    }, <StudentAchievementsTab />)

    expect(await screen.findByRole('region', { name: 'Achievement trail' })).toBeVisible()
    expect(document.querySelector('aside.pal-companion')).toHaveAttribute(
      'aria-label',
      expect.stringContaining(snapshot.companion.name),
    )
    expect(await screen.findByRole('dialog', { name: 'Reward earned' })).toBeVisible()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(document.querySelector('iframe')).toBeNull()
    expect(mockCreatePikaPalClient).toHaveBeenCalledWith('https://pal.example.test')
  })

  it('hosts Pal story finish and title presentation in the Pika-owned reward modal', async () => {
    const snapshot = withStoryReward()
    renderExperience({
      getSnapshot: async () => snapshot,
      markRewardSeen: async () => undefined,
    })

    expect(await screen.findByRole('dialog', { name: 'Reward earned' })).toBeVisible()
    expect(screen.getByText('Story unlocked')).toBeVisible()
    expect(screen.getByText('The Clockwork Lantern')).toBeVisible()
    expect(screen.getByText('Storybook sketch')).toBeVisible()
    expect(screen.getByText('Story Keeper')).toBeVisible()
    expect(document.querySelector('[data-collectible-finish="sketch"]')).not.toBeNull()
  })

  it('acknowledges an Escape close and removes the modal only after success', async () => {
    const snapshot = withReward()
    let resolveAcknowledgement: (() => void) | undefined
    const markRewardSeen = vi.fn(() => new Promise<void>((resolve) => {
      resolveAcknowledgement = resolve
    }))
    renderExperience({ getSnapshot: async () => snapshot, markRewardSeen })

    expect(await screen.findByRole('dialog', { name: 'Reward earned' })).toBeVisible()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(markRewardSeen).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: 'Reward earned' })).toBeVisible()

    await act(async () => resolveAcknowledgement?.())
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Reward earned' })).toBeNull()
    })
  })

  it('keeps the reward retryable and academic work usable when acknowledgement fails', async () => {
    const snapshot = withReward()
    const markRewardSeen = vi.fn(async () => {
      throw new Error('Pal unavailable')
    })
    renderExperience({ getSnapshot: async () => snapshot, markRewardSeen })

    expect(await screen.findByRole('dialog', { name: 'Reward earned' })).toBeVisible()
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(await screen.findByText('We could not save that yet. Try again.')).toBeVisible()
    expect(screen.getByRole('dialog', { name: 'Reward earned' })).toBeVisible()
    expect(screen.getByText('Academic work remains available')).toBeInTheDocument()
  })

  it('contains a snapshot failure to Pal while leaving Pika content usable', async () => {
    renderExperience({
      getSnapshot: async () => { throw new Error('Pal unavailable') },
      markRewardSeen: async () => undefined,
    }, <><div>Academic work remains available</div><StudentAchievementsTab /></>)

    expect(await screen.findByRole('alert')).toHaveTextContent('Achievements unavailable')
    expect(screen.getByText('Academic work remains available')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('never paints a stale learner snapshot after the authenticated scope changes', async () => {
    const learnerA = createFixtureSnapshot()
    learnerA.companion.name = 'Learner A companion'
    unlockCompanion(learnerA, 'learner-a-companion')
    const learnerB = createFixtureSnapshot()
    learnerB.companion.name = 'Learner B companion'
    unlockCompanion(learnerB, 'learner-b-companion')
    let resolveLearnerA: ((snapshot: PalWidgetSnapshot) => void) | undefined
    const getSnapshot = vi.fn()
      .mockImplementationOnce(() => new Promise<PalWidgetSnapshot>((resolve) => {
        resolveLearnerA = resolve
      }))
      .mockResolvedValueOnce(learnerB)
    const client: PalClient = {
      getSnapshot,
      markRewardSeen: async () => undefined,
    }
    mockCreatePikaPalClient.mockReturnValue(client)

    const view = render(
      <ThemeProvider>
        <StudentPalExperience apiBaseUrl="https://pal.example.test" scopeKey="session-a">
          <div>Academic work remains available</div>
        </StudentPalExperience>
      </ThemeProvider>,
    )

    view.rerender(
      <ThemeProvider>
        <StudentPalExperience apiBaseUrl="https://pal.example.test" scopeKey="session-b">
          <div>Academic work remains available</div>
        </StudentPalExperience>
      </ThemeProvider>,
    )

    expect(await screen.findByRole('complementary', {
      name: /Learner B companion/,
    })).toBeVisible()
    await act(async () => resolveLearnerA?.(learnerA))
    expect(screen.queryByRole('complementary', {
      name: /Learner A companion/,
    })).toBeNull()
    expect(screen.getByRole('complementary', {
      name: /Learner B companion/,
    })).toBeVisible()
    expect(mockCreatePikaPalClient).toHaveBeenCalledTimes(2)
  })

  it('contains a synchronous Pal surface failure without enclosing the classroom shell', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const suppressExpectedWindowError = (event: ErrorEvent) => event.preventDefault()
    window.addEventListener('error', suppressExpectedWindowError)
    const client: PalClient = {
      getSnapshot: async () => createFixtureSnapshot(),
      markRewardSeen: async () => undefined,
    }
    mockCreatePikaPalClient.mockReturnValue(client)
    function ThrowingPalSurface(): ReactNode {
      throw new Error('Pal render failed')
    }

    render(
      <ThemeProvider>
        <StudentPalExperience apiBaseUrl="https://pal.example.test" scopeKey="session-a">
          <div>Academic work remains available</div>
          <PalFailureBoundary
            fallback={<div>Pal surface unavailable</div>}
            resetKey="session-a:surface"
          >
            <ThrowingPalSurface />
          </PalFailureBoundary>
        </StudentPalExperience>
      </ThemeProvider>,
    )

    expect(screen.getByText('Academic work remains available')).toBeVisible()
    expect(screen.getByText('Pal surface unavailable')).toBeVisible()
    window.removeEventListener('error', suppressExpectedWindowError)
    consoleError.mockRestore()
  })

  it('does not misclassify a Pika classroom exception as a Pal failure', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const suppressExpectedWindowError = (event: ErrorEvent) => event.preventDefault()
    window.addEventListener('error', suppressExpectedWindowError)
    const client: PalClient = {
      getSnapshot: async () => createFixtureSnapshot(),
      markRewardSeen: async () => undefined,
    }
    function ThrowingPikaShell(): ReactNode {
      throw new Error('Pika classroom failed')
    }

    expect(() => renderExperience(client, <ThrowingPikaShell />)).toThrow(
      'Pika classroom failed',
    )
    window.removeEventListener('error', suppressExpectedWindowError)
    consoleError.mockRestore()
  })

  it('defers companion and reward overlays on the student tests surface', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('tab=tests'))
    window.history.replaceState({}, '', '/classrooms/example?tab=tests')
    const snapshot = withReward()
    renderExperience({
      getSnapshot: async () => snapshot,
      markRewardSeen: async () => undefined,
    }, <div>Student test workspace</div>)

    await waitFor(() => expect(mockCreatePikaPalClient).toHaveBeenCalled())
    expect(screen.getByText('Student test workspace')).toBeVisible()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(snapshot.companion.name)).toBeNull()
  })

  it('tracks Pika History API tab changes after the persistent layout mounts', async () => {
    renderExperience({
      getSnapshot: async () => createFixtureSnapshot(),
      markRewardSeen: async () => undefined,
    })

    expect(await screen.findByRole('complementary', {
      name: /Mystery companion/,
    })).toBeVisible()

    act(() => {
      window.history.pushState({}, '', '/classrooms/example?tab=tests')
      window.dispatchEvent(new Event(PIKA_LOCATION_CHANGE_EVENT))
    })
    expect(screen.queryByRole('complementary', {
      name: /Mystery companion/,
    })).toBeNull()

    act(() => {
      window.history.pushState({}, '', '/classrooms/example?tab=today')
      window.dispatchEvent(new Event(PIKA_LOCATION_CHANGE_EVENT))
    })
    expect(screen.getByRole('complementary', {
      name: /Mystery companion/,
    })).toBeVisible()
  })

  it('refreshes the learner snapshot immediately after a confirmed event delivery', async () => {
    const getSnapshot = vi.fn(async () => createFixtureSnapshot())
    renderExperience({
      getSnapshot,
      markRewardSeen: async () => undefined,
    }, <div>Student work</div>, false)

    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(1))
    act(() => {
      window.dispatchEvent(new Event(PIKA_PAL_REFRESH_EVENT))
    })
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2))
  })
})
