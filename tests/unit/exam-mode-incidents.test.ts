import { describe, expect, it } from 'vitest'
import {
  createExamIncidentState,
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
