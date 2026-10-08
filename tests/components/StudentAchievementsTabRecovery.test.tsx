import { PalProvider, createFixtureSnapshot, usePalWidget } from '@codepet/pal-widget'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fault = vi.hoisted(() => ({ armed: true }))

// Keep the host boundary, theme, controls and provider real. The leaf stays
// armed through React's render replay until the committed fallback is observed.
vi.mock('@codepet/pal-widget', async (importOriginal) => ({
  ...await importOriginal<typeof import('@codepet/pal-widget')>(),
  PalAchievements: () => {
    if (fault.armed) throw new Error('Controlled roadmap render failure')
    return <div>Recovered roadmap</div>
  },
}))

import {
  StudentAchievementsRecovery,
  StudentAchievementsTab,
} from '@/app/classrooms/[classroomId]/StudentAchievementsTab'
import { TabContentTransition } from '@/ui'

function suppressControlledError(event: ErrorEvent) {
  if (event.error?.message === 'Controlled roadmap render failure') event.preventDefault()
}

describe('StudentAchievementsTab local render recovery', () => {
  beforeEach(() => {
    fault.armed = true
    window.addEventListener('error', suppressControlledError)
  })

  afterEach(() => {
    window.removeEventListener('error', suppressControlledError)
    vi.restoreAllMocks()
  })

  it('offers intentional recovery after an initial failure without stealing focus', async () => {
    const user = userEvent.setup()
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    try {
      render(<StudentAchievementsTab />)
      const retry = screen.getByRole('button', { name: 'Try again' })
      expect(screen.getByRole('alert')).toHaveTextContent('Try again to load your roadmap.')
      expect(retry).toHaveAttribute('type', 'button')
      expect(outside).toHaveFocus()
      // Clearing the cause alone does not reset a committed boundary failure.
      fault.armed = false
      expect(screen.queryByText('Recovered roadmap')).toBeNull()
      await user.click(retry)
      expect(screen.getByText('Recovered roadmap')).toBeVisible()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.getByRole('region', { name: 'Achievements', exact: true })).toHaveFocus()
    } finally {
      outside.remove()
    }
  })

  it('focuses the retained region before removing Retry and permits repeated failures', async () => {
    const user = userEvent.setup()
    render(<StrictMode><StudentAchievementsTab /></StrictMode>)
    const firstRetry = screen.getByRole('button', { name: 'Try again' })
    const region = screen.getByRole('region', { name: 'Achievements', exact: true })
    expect(region).toHaveAttribute('tabindex', '-1')
    const nativeFocus = region.focus.bind(region)
    const focus = vi.spyOn(region, 'focus').mockImplementation((options) => {
      expect(screen.getByRole('button', { name: 'Try again' }).isConnected).toBe(true)
      nativeFocus(options)
    })

    await user.click(firstRetry)
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
    expect(region).toHaveFocus()
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Achievements', exact: true })).toBe(region)

    await user.tab()
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(region).toHaveFocus()
    expect(screen.getByRole('alert')).toBeVisible()

    fault.armed = false
    await user.tab()
    await user.keyboard(' ')
    expect(screen.getByText('Recovered roadmap')).toBeVisible()
    expect(region).toHaveFocus()
    expect(screen.getByRole('region', { name: 'Achievements', exact: true })).toBe(region)
    focus.mockRestore()
  })

  it('retains academic DOM state and the provider scope, snapshot and reward through retries', async () => {
    const user = userEvent.setup()
    const snapshot = createFixtureSnapshot()
    snapshot.rewards = [{ id: 'unseen-reward', title: 'A keepsake', description: 'Earned today.' }]
    const client = {
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      markRewardSeen: vi.fn().mockResolvedValue(undefined),
    }
    let context: ReturnType<typeof usePalWidget>
    let providerLifetime: object
    function ProviderProbe() {
      context = usePalWidget()
      providerLifetime = useRef({}).current
      return <output>{context.scopeKey}: {context.snapshot?.rewards[0]?.id}</output>
    }

    render(
      <PalProvider client={client} initialSnapshot={snapshot} scopeKey="learner-a">
        <input aria-label="Academic draft" defaultValue="" />
        <ProviderProbe />
        <StudentAchievementsTab />
      </PalProvider>,
    )
    // Let the provider's ordinary initial read finish before measuring retry.
    await act(async () => { await Promise.resolve() })
    const initialContext = context!
    const initialLifetime = providerLifetime!
    const draft = screen.getByRole('textbox', { name: 'Academic draft' })
    fireEvent.change(draft, { target: { value: 'Unsubmitted academic work' } })
    client.getSnapshot.mockClear()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('alert')).toBeVisible()
    fault.armed = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByRole('textbox', { name: 'Academic draft' })).toBe(draft)
    expect(draft).toHaveValue('Unsubmitted academic work')
    expect(providerLifetime!).toBe(initialLifetime)
    expect(context!).toBe(initialContext)
    expect(context!.snapshot).toBe(initialContext.snapshot)
    expect(screen.getByText('learner-a: unseen-reward')).toBeVisible()
    expect(client.getSnapshot).not.toHaveBeenCalled()
    expect(client.markRewardSeen).not.toHaveBeenCalled()
  })

  it('does not retry or move focus after a background failure or hide/return', async () => {
    fault.armed = false
    function Host({ active }: { active: boolean }) {
      return (
        <>
          <input aria-label="Academic draft" />
          <TabContentTransition isActive={active}><StudentAchievementsTab /></TabContentTransition>
        </>
      )
    }
    const view = render(<Host active />)
    const region = screen.getByRole('region', { name: 'Achievements', exact: true })
    const draft = screen.getByRole('textbox', { name: 'Academic draft' })
    draft.focus()
    fault.armed = true
    view.rerender(<Host active={false} />)
    expect(region.parentElement).toHaveAttribute('inert')
    expect(region.parentElement).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(region.querySelector('[data-page-state="error"]')).not.toBeNull()
    expect(draft).toHaveFocus()

    fault.armed = false
    await act(async () => { await Promise.resolve() })
    view.rerender(<Host active />)
    expect(screen.getByRole('region', { name: 'Achievements', exact: true })).toBe(region)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
    expect(screen.queryByText('Recovered roadmap')).toBeNull()
    expect(draft).toHaveFocus()
  })

  it('discards a failed owner on ordinary unmount and keyed provider scope changes', async () => {
    const snapshot = createFixtureSnapshot()
    const client = { getSnapshot: vi.fn().mockResolvedValue(snapshot), markRewardSeen: vi.fn() }
    function Leaf() {
      const { scopeKey } = usePalWidget()
      if (fault.armed) throw new Error('Controlled roadmap render failure')
      return <div>Roadmap for {scopeKey}</div>
    }
    function Host({ scope, mounted = true }: { scope: string; mounted?: boolean }) {
      return (
        <PalProvider key={scope} scopeKey={scope} client={client} initialSnapshot={snapshot}>
          <input aria-label="Academic draft" />
          {mounted ? <StudentAchievementsRecovery><Leaf /></StudentAchievementsRecovery> : null}
        </PalProvider>
      )
    }
    const view = render(<Host scope="learner-a" />)
    const oldRegion = screen.getByRole('region', { name: 'Achievements', exact: true })
    screen.getByRole('textbox', { name: 'Academic draft' }).focus()
    fault.armed = false
    view.rerender(<Host scope="learner-a" mounted={false} />)
    view.rerender(<Host scope="learner-a" />)
    expect(screen.getByText('Roadmap for learner-a')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Achievements', exact: true })).not.toBe(oldRegion)
    expect(screen.getByRole('textbox', { name: 'Academic draft' })).toHaveFocus()

    fault.armed = true
    view.rerender(<Host scope="learner-a" />)
    expect(screen.getByRole('alert')).toBeVisible()
    fault.armed = false
    view.rerender(<Host scope="learner-b" />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('Roadmap for learner-b')).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('region', { name: 'Achievements', exact: true })).not.toHaveFocus()
  })
})
