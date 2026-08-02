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

vi.mock('@/integrations/pal/pal-client', () => ({
  createPikaPalClient: mockCreatePikaPalClient,
}))

import { ThemeProvider } from '@/contexts/ThemeContext'
import {
  PalFailureBoundary,
  StudentPalExperience,
} from '@/integrations/pal/StudentPalExperience'
import { StudentAchievementsTab } from '@/app/classrooms/[classroomId]/StudentAchievementsTab'

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
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('mounts roadmap, companion, and one Pika-owned reward dialog', async () => {
    const snapshot = withReward()
    renderExperience({
      getSnapshot: async () => snapshot,
      markRewardSeen: async () => undefined,
    }, <StudentAchievementsTab />)

    expect(await screen.findByRole('heading', { name: 'Your achievement path' })).toBeVisible()
    expect(screen.getByText(snapshot.companion.name)).toBeVisible()
    expect(await screen.findByRole('dialog', { name: 'Reward earned' })).toBeVisible()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(document.querySelector('iframe')).toBeNull()
    expect(mockCreatePikaPalClient).toHaveBeenCalledWith('https://pal.example.test')
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

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Achievements are temporarily unavailable',
    )
    expect(screen.getByText('Academic work remains available')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('never paints a stale learner snapshot after the authenticated scope changes', async () => {
    const learnerA = createFixtureSnapshot()
    learnerA.companion.name = 'Learner A companion'
    const learnerB = createFixtureSnapshot()
    learnerB.companion.name = 'Learner B companion'
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

    expect(await screen.findByText('Learner B companion')).toBeVisible()
    await act(async () => resolveLearnerA?.(learnerA))
    expect(screen.queryByText('Learner A companion')).toBeNull()
    expect(screen.getByText('Learner B companion')).toBeVisible()
  })

  it('contains a synchronous Pal render failure outside the classroom shell', () => {
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
        <PalFailureBoundary
          fallback={<div>Academic classroom fallback</div>}
          resetKey="session-a"
        >
          <StudentPalExperience apiBaseUrl="https://pal.example.test" scopeKey="session-a">
            <ThrowingPalSurface />
          </StudentPalExperience>
        </PalFailureBoundary>
      </ThemeProvider>,
    )

    expect(screen.getByText('Academic classroom fallback')).toBeVisible()
    window.removeEventListener('error', suppressExpectedWindowError)
    consoleError.mockRestore()
  })

  it('defers companion and reward overlays on the student tests surface', async () => {
    const snapshot = withReward()
    renderExperience({
      getSnapshot: async () => snapshot,
      markRewardSeen: async () => undefined,
    }, <div>Student test workspace</div>, false)

    await waitFor(() => expect(mockCreatePikaPalClient).toHaveBeenCalled())
    expect(screen.getByText('Student test workspace')).toBeVisible()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(snapshot.companion.name)).toBeNull()
  })
})
