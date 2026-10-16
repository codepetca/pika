import { describe, expect, it } from 'vitest'
import {
  createExamIncidentState,
  EXAM_BROWSER_CONTEXT_MENU_INTENT_MS,
  hasCurrentBrowserInteractionIntent,
  reduceExamIncident,
  type ExamIncidentEffect,
  type ExamIncidentState,
} from '@/lib/exam-mode-incidents'

function transition(
  state: ExamIncidentState,
  event: Parameters<typeof reduceExamIncident>[1]
): { state: ExamIncidentState; effects: ExamIncidentEffect[] } {
  return reduceExamIncident(state, event)
}

describe('exam mode exit incidents', () => {
  it('captures a sub-second hidden-page switch as exactly one incident', () => {
    const hidden = transition(createExamIncidentState(), {
      type: 'visibility_hidden',
      atMs: 1_000,
      incidentId: 'incident-1',
    })

    expect(hidden.effects).toEqual([
      {
        type: 'away_start',
        incidentId: 'incident-1',
        source: 'visibility',
        occurredAtMs: 1_000,
      },
    ])

    const visible = transition(hidden.state, {
      type: 'visibility_visible',
      atMs: 1_125,
    })

    expect(visible.effects).toEqual([
      {
        type: 'away_end',
        incidentId: 'incident-1',
        source: 'visibility',
        occurredAtMs: 1_125,
        durationMs: 125,
      },
    ])
  })

  it('does not count a transient blur while the page remains visible', () => {
    const blurred = transition(createExamIncidentState(), {
      type: 'blur',
      atMs: 1_000,
    })
    const focused = transition(blurred.state, {
      type: 'focus',
      atMs: 1_200,
      incidentId: 'unused-incident',
    })

    expect(blurred.effects).toEqual([])
    expect(focused.effects).toEqual([])
    expect(focused.state.pendingBlurAtMs).toBeNull()
  })

  it('counts a sustained visible-page focus loss after confirmation', () => {
    const blurred = transition(createExamIncidentState(), {
      type: 'blur',
      atMs: 1_000,
    })
    const confirmed = transition(blurred.state, {
      type: 'blur_timeout',
      atMs: 1_600,
      incidentId: 'incident-1',
    })

    expect(confirmed.effects).toEqual([
      {
        type: 'away_start',
        incidentId: 'incident-1',
        source: 'blur',
        occurredAtMs: 1_000,
      },
    ])

    const focused = transition(confirmed.state, {
      type: 'focus',
      atMs: 1_900,
      incidentId: 'unused-incident',
    })
    expect(focused.effects).toEqual([
      {
        type: 'away_end',
        incidentId: 'incident-1',
        source: 'focus',
        occurredAtMs: 1_900,
        durationMs: 900,
      },
    ])
  })

  it('captures sustained focus loss when the blur timer is throttled until focus returns', () => {
    const blurred = transition(createExamIncidentState(), {
      type: 'blur',
      atMs: 1_000,
    })
    const focused = transition(blurred.state, {
      type: 'focus',
      atMs: 2_000,
      incidentId: 'incident-1',
    })

    expect(focused.effects).toEqual([
      {
        type: 'away_start',
        incidentId: 'incident-1',
        source: 'blur',
        occurredAtMs: 1_000,
      },
      {
        type: 'away_end',
        incidentId: 'incident-1',
        source: 'focus',
        occurredAtMs: 2_000,
        durationMs: 1_000,
      },
    ])
  })

  it('lets a hidden-page signal supersede a pending blur without double counting', () => {
    const blurred = transition(createExamIncidentState(), {
      type: 'blur',
      atMs: 1_000,
    })
    const hidden = transition(blurred.state, {
      type: 'visibility_hidden',
      atMs: 1_050,
      incidentId: 'incident-1',
    })

    expect(hidden.effects).toHaveLength(1)
    expect(hidden.effects[0]).toMatchObject({
      type: 'away_start',
      incidentId: 'incident-1',
      source: 'visibility',
    })

    const focusedWhileHidden = transition(hidden.state, {
      type: 'focus',
      atMs: 1_100,
      incidentId: 'unused-incident',
    })
    expect(focusedWhileHidden.effects).toEqual([])

    const visible = transition(focusedWhileHidden.state, {
      type: 'visibility_visible',
      atMs: 1_150,
    })
    expect(visible.effects).toHaveLength(1)
    expect(visible.effects[0]).toMatchObject({
      type: 'away_end',
      incidentId: 'incident-1',
      durationMs: 100,
    })
  })

  it('correlates fullscreen, resize, and lifecycle signals to the active away incident', () => {
    const hidden = transition(createExamIncidentState(), {
      type: 'visibility_hidden',
      atMs: 1_000,
      incidentId: 'incident-1',
    })
    const windowLoss = transition(hidden.state, {
      type: 'window_noncompliant',
      atMs: 1_400,
      incidentId: 'unused-window-id',
      source: 'fullscreen_exit',
    })
    const visible = transition(windowLoss.state, {
      type: 'visibility_visible',
      atMs: 1_500,
    })
    const pageHide = transition(visible.state, {
      type: 'lifecycle_exit',
      atMs: 1_550,
      incidentId: 'unused-lifecycle-id',
      source: 'pagehide',
    })

    expect(windowLoss.effects).toEqual([
      {
        type: 'window_exit',
        incidentId: 'incident-1',
        source: 'fullscreen_exit',
        occurredAtMs: 1_400,
      },
    ])
    expect(pageHide.effects).toEqual([
      {
        type: 'route_exit',
        incidentId: 'incident-1',
        source: 'pagehide',
        occurredAtMs: 1_550,
      },
    ])
  })

  it('counts separate rapid hidden-page episodes separately', () => {
    const firstHidden = transition(createExamIncidentState(), {
      type: 'visibility_hidden',
      atMs: 1_000,
      incidentId: 'incident-1',
    })
    const firstVisible = transition(firstHidden.state, {
      type: 'visibility_visible',
      atMs: 1_100,
    })
    const secondHidden = transition(firstVisible.state, {
      type: 'visibility_hidden',
      atMs: 1_250,
      incidentId: 'incident-2',
    })

    expect(firstHidden.effects[0]).toMatchObject({ incidentId: 'incident-1' })
    expect(secondHidden.effects[0]).toMatchObject({ incidentId: 'incident-2' })
  })

  it('deduplicates unload lifecycle signals while preserving explicit blocked navigation attempts', () => {
    const beforeUnload = transition(createExamIncidentState(), {
      type: 'lifecycle_exit',
      atMs: 1_000,
      incidentId: 'incident-1',
      source: 'beforeunload',
    })
    const pageHide = transition(beforeUnload.state, {
      type: 'lifecycle_exit',
      atMs: 1_050,
      incidentId: 'incident-2',
      source: 'pagehide',
    })

    expect(beforeUnload.effects[0]).toMatchObject({ incidentId: 'incident-1' })
    expect(pageHide.effects[0]).toMatchObject({ incidentId: 'incident-1' })

    const firstBlocked = transition(pageHide.state, {
      type: 'route_exit',
      atMs: 1_100,
      incidentId: 'incident-3',
      source: 'home_navigation',
    })
    const secondBlocked = transition(firstBlocked.state, {
      type: 'route_exit',
      atMs: 1_250,
      incidentId: 'incident-4',
      source: 'tab_navigation',
    })

    expect(firstBlocked.effects[0]).toMatchObject({ incidentId: 'incident-3' })
    expect(secondBlocked.effects[0]).toMatchObject({ incidentId: 'incident-4' })
  })

  it('reuses a recent point incident when a related hidden signal arrives afterward', () => {
    const windowLoss = transition(createExamIncidentState(), {
      type: 'window_noncompliant',
      atMs: 1_000,
      incidentId: 'incident-1',
      source: 'window_resize',
    })
    const hidden = transition(windowLoss.state, {
      type: 'visibility_hidden',
      atMs: 1_200,
      incidentId: 'incident-2',
    })

    expect(windowLoss.effects[0]).toMatchObject({ incidentId: 'incident-1' })
    expect(hidden.effects[0]).toMatchObject({ incidentId: 'incident-1' })
  })

  it('keeps lifecycle cleanup correlated with a route exit during unmount', () => {
    const routeExit = transition(createExamIncidentState(), {
      type: 'route_exit',
      atMs: 1_000,
      incidentId: 'incident-1',
      source: 'in_app_navigation',
    })
    const cleanup = transition(routeExit.state, {
      type: 'reset',
      atMs: 1_050,
    })
    const unmount = transition(cleanup.state, {
      type: 'lifecycle_exit',
      atMs: 1_060,
      incidentId: 'incident-2',
      source: 'component_unmount',
    })

    expect(cleanup.effects).toEqual([])
    expect(unmount.effects[0]).toMatchObject({ incidentId: 'incident-1' })
  })
})

function openSelectedTextMenu(state = createExamIncidentState(), atMs = 1_000) {
  return transition(state, {
    type: 'context_menu',
    atMs,
    incidentId: 'browser-1',
    hasSelection: true,
    isCompliant: true,
  })
}

function startBrowserInteraction() {
  return transition(openSelectedTextMenu().state, {
    type: 'blur',
    atMs: 1_100,
    isCompliant: true,
  })
}

describe('selected-text browser interactions', () => {
  it('records a long eligible browser interaction separately without an away incident', () => {
    const menu = openSelectedTextMenu()
    expect(hasCurrentBrowserInteractionIntent(menu.state, 1_100)).toBe(true)
    const blurred = transition(menu.state, { type: 'blur', atMs: 1_100, isCompliant: true })
    const timeout = transition(blurred.state, {
      type: 'blur_timeout', atMs: 200_000, incidentId: 'unused-away',
    })
    const focused = transition(timeout.state, {
      type: 'focus', atMs: 201_100, incidentId: 'unused-focus',
    })

    expect([...menu.effects, ...blurred.effects, ...timeout.effects]).toEqual([])
    expect(hasCurrentBrowserInteractionIntent(blurred.state, 1_100)).toBe(false)
    expect(focused.effects).toEqual([{
      type: 'browser_interaction_end', incidentId: 'browser-1',
      occurredAtMs: 201_100, durationMs: 200_000,
    }])
    expect(focused.state.activeIncident).toBeNull()
    expect(focused.state.recentIncident).toBeNull()
    expect(focused.state.browserInteraction).toBeNull()
    expect(focused.state.pendingBlurAtMs).toBeNull()
  })

  it.each(['empty selection', 'noncompliant menu', 'hidden page', 'expired intent', 'unarmed', 'noncompliant blur'])(
    'preserves ordinary focus-loss detection with %s', (reason) => {
      let state = createExamIncidentState()
      if (reason === 'hidden page') {
        state = transition(state, { type: 'visibility_hidden', atMs: 800, incidentId: 'hidden' }).state
      }
      if (reason !== 'unarmed') {
        state = transition(state, {
          type: 'context_menu', atMs: 1_000, incidentId: 'browser-1',
          hasSelection: reason !== 'empty selection', isCompliant: reason !== 'noncompliant menu',
        }).state
      }
      if (reason === 'hidden page') {
        state = transition(state, { type: 'visibility_visible', atMs: 1_050 }).state
      }
      const atMs = reason === 'expired intent' ? 1_001 + EXAM_BROWSER_CONTEXT_MENU_INTENT_MS : 1_100
      const blurred = transition(state, {
        type: 'blur', atMs, isCompliant: reason !== 'noncompliant blur',
      })
      const focused = transition(blurred.state, { type: 'focus', atMs: atMs + 1_000, incidentId: 'real-away' })
      expect(focused.effects).toEqual([
        { type: 'away_start', incidentId: 'real-away', source: 'blur', occurredAtMs: atMs },
        { type: 'away_end', incidentId: 'real-away', source: 'focus', occurredAtMs: atMs + 1_000, durationMs: 1_000 },
      ])
    }
  )

  it('expires intent at its deadline and never accepts a blur before the menu', () => {
    const menu = openSelectedTextMenu()
    expect(hasCurrentBrowserInteractionIntent(menu.state, 999)).toBe(false)
    expect(hasCurrentBrowserInteractionIntent(menu.state, 1_000 + EXAM_BROWSER_CONTEXT_MENU_INTENT_MS - 1)).toBe(true)
    expect(hasCurrentBrowserInteractionIntent(menu.state, 1_000 + EXAM_BROWSER_CONTEXT_MENU_INTENT_MS)).toBe(false)
  })

  it.each([false, true])('cannot convert a pending or confirmed real blur (confirmed=%s)', (confirmed) => {
    let state = transition(createExamIncidentState(), { type: 'blur', atMs: 500 }).state
    if (confirmed) {
      state = transition(state, { type: 'blur_timeout', atMs: 1_100, incidentId: 'real-away' }).state
    }
    const menu = openSelectedTextMenu(state, 1_200)
    expect(hasCurrentBrowserInteractionIntent(menu.state, 1_200)).toBe(false)
    const focused = transition(menu.state, { type: 'focus', atMs: 1_500, incidentId: 'real-away' })
    expect(focused.effects.some(effect => effect.type === 'browser_interaction_end')).toBe(false)
    expect(focused.effects).toContainEqual({
      type: 'away_end', incidentId: 'real-away', source: 'focus', occurredAtMs: 1_500, durationMs: 1_000,
    })
  })

  it('consumes intent once and ignores duplicate blur without restarting the duration', () => {
    const started = startBrowserInteraction()
    const duplicate = transition(started.state, { type: 'blur', atMs: 1_400 })
    const focused = transition(duplicate.state, { type: 'focus', atMs: 1_700, incidentId: 'unused' })
    expect(duplicate.effects).toEqual([])
    expect(focused.effects).toEqual([{
      type: 'browser_interaction_end', incidentId: 'browser-1', occurredAtMs: 1_700, durationMs: 600,
    }])
    const nextBlur = transition(focused.state, { type: 'blur', atMs: 1_800 })
    expect(transition(nextBlur.state, { type: 'blur_timeout', atMs: 2_400, incidentId: 'real-away' }).effects)
      .toEqual([{ type: 'away_start', incidentId: 'real-away', source: 'blur', occurredAtMs: 1_800 }])
  })

  it('does not arm another intent from a menu during an active browser interaction', () => {
    const menu = openSelectedTextMenu(startBrowserInteraction().state, 1_200)
    expect(hasCurrentBrowserInteractionIntent(menu.state, 1_200)).toBe(false)
    const focused = transition(menu.state, { type: 'focus', atMs: 1_500, incidentId: 'unused' })
    expect(focused.effects).toEqual([{
      type: 'browser_interaction_end', incidentId: 'browser-1', occurredAtMs: 1_500, durationMs: 400,
    }])
  })

  const hardEvents = [
    { type: 'visibility_hidden', atMs: 1_500, incidentId: 'real-exit' },
    { type: 'window_noncompliant', atMs: 1_500, incidentId: 'real-exit', source: 'fullscreen_exit' },
    { type: 'window_noncompliant', atMs: 1_500, incidentId: 'real-exit', source: 'window_resize' },
    { type: 'route_exit', atMs: 1_500, incidentId: 'real-exit', source: 'home_navigation' },
    { type: 'lifecycle_exit', atMs: 1_500, incidentId: 'real-exit', source: 'pagehide' },
  ] as const

  it.each(hardEvents)('flushes browser duration and preserves $type as a real exit', (event) => {
    const result = transition(startBrowserInteraction().state, event)
    const ordinary = transition(createExamIncidentState(), event)
    expect(result.effects).toEqual([
      { type: 'browser_interaction_end', incidentId: 'browser-1', occurredAtMs: 1_500, durationMs: 400 },
      ...ordinary.effects,
    ])
    expect(result.state.browserInteraction).toBeNull()
    expect(result.state.browserIntent).toBeNull()
  })

  it.each(hardEvents)('clears unused intent on $type', (event) => {
    const result = transition(openSelectedTextMenu().state, event)
    expect(result.effects).toEqual(transition(createExamIncidentState(), event).effects)
    expect(hasCurrentBrowserInteractionIntent(result.state, 1_500)).toBe(false)
  })

  it.each(hardEvents)('does not correlate a completed browser interaction with nearby $type', (event) => {
    const focused = transition(startBrowserInteraction().state, {
      type: 'focus', atMs: 1_400, incidentId: 'unused',
    })
    const result = transition(focused.state, event)
    expect(result.effects).toEqual(transition(createExamIncidentState(), event).effects)
    expect(result.effects.every(effect => effect.incidentId === 'real-exit')).toBe(true)
  })

  it('preserves prior real-incident correlation across a browser interaction', () => {
    const point = transition(createExamIncidentState(), {
      type: 'window_noncompliant', atMs: 800, incidentId: 'real-point', source: 'window_resize',
    })
    const menu = openSelectedTextMenu(point.state)
    const blurred = transition(menu.state, { type: 'blur', atMs: 1_100 })
    const focused = transition(blurred.state, { type: 'focus', atMs: 1_400, incidentId: 'unused' })
    const lifecycle = transition(focused.state, { type: 'lifecycle_exit', atMs: 1_500, incidentId: 'unused', source: 'pagehide' })
    expect(lifecycle.effects[0]).toMatchObject({ incidentId: 'real-point', type: 'route_exit' })
  })

  it('cancels unused intent on explicit cancellation, invalid menu, or focus', () => {
    const events = [
      { type: 'cancel_browser_intent', atMs: 1_100 },
      { type: 'context_menu', atMs: 1_100, incidentId: 'invalid', hasSelection: false, isCompliant: true },
      { type: 'focus', atMs: 1_100, incidentId: 'unused' },
    ] as const
    for (const event of events) {
      const result = transition(openSelectedTextMenu().state, event)
      expect(hasCurrentBrowserInteractionIntent(result.state, 1_100)).toBe(false)
      const blurred = transition(result.state, { type: 'blur', atMs: 1_200 })
      expect(transition(blurred.state, { type: 'blur_timeout', atMs: 1_800, incidentId: 'real-away' }).effects)
        .toEqual([{ type: 'away_start', incidentId: 'real-away', source: 'blur', occurredAtMs: 1_200 }])
    }
  })

  it('explicit cancellation leaves an active browser interaction running', () => {
    const cancelled = transition(startBrowserInteraction().state, { type: 'cancel_browser_intent', atMs: 1_200 })
    expect(cancelled.effects).toEqual([])
    const focused = transition(cancelled.state, { type: 'focus', atMs: 1_500, incidentId: 'unused' })
    expect(focused.effects).toEqual([{
      type: 'browser_interaction_end', incidentId: 'browser-1', occurredAtMs: 1_500, durationMs: 400,
    }])
  })

  it('flushes an active browser duration on reset and clears unused intent', () => {
    const ended = transition(startBrowserInteraction().state, { type: 'reset', atMs: 1_500 })
    expect(ended.effects).toEqual([{
      type: 'browser_interaction_end', incidentId: 'browser-1', occurredAtMs: 1_500, durationMs: 400,
    }])
    expect(ended.state).toEqual(createExamIncidentState())
    const cleared = transition(openSelectedTextMenu().state, { type: 'reset', atMs: 1_100 })
    expect(cleared.effects).toEqual([])
    expect(cleared.state).toEqual(createExamIncidentState())
  })
})
