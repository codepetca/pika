export const EXAM_FOCUS_LOSS_GRACE_MS = 600
export const EXAM_INCIDENT_CORRELATION_MS = 1_500
export const EXAM_BROWSER_CONTEXT_MENU_INTENT_MS = 15_000

type AwaySource = 'visibility' | 'blur'

type ExamIncident = {
  id: string
  startedAtMs: number
  endedAtMs: number | null
  awayStartedAtMs: number | null
  awaySource: AwaySource | null
  signals: string[]
}

export type ExamIncidentState = {
  documentVisible: boolean
  pendingBlurAtMs: number | null
  activeIncident: ExamIncident | null
  recentIncident: ExamIncident | null
  browserIntent: { incidentId: string; expiresAtMs: number } | null
  browserInteraction: { id: string; startedAtMs: number } | null
}

export type ExamIncidentEvent =
  | { type: 'blur'; atMs: number; isCompliant?: boolean }
  | {
      type: 'context_menu'
      atMs: number
      incidentId: string
      hasSelection: boolean
      isCompliant: boolean
    }
  | { type: 'cancel_browser_intent'; atMs: number }
  | { type: 'focus'; atMs: number; incidentId: string }
  | { type: 'blur_timeout'; atMs: number; incidentId: string }
  | { type: 'visibility_hidden'; atMs: number; incidentId: string }
  | { type: 'visibility_visible'; atMs: number }
  | {
      type: 'window_noncompliant'
      atMs: number
      incidentId: string
      source: 'fullscreen_exit' | 'window_resize'
    }
  | { type: 'route_exit'; atMs: number; incidentId: string; source: string }
  | { type: 'lifecycle_exit'; atMs: number; incidentId: string; source: string }
  | { type: 'reset'; atMs: number }

export type ExamIncidentEffect =
  | {
      type: 'browser_interaction_end'
      incidentId: string
      occurredAtMs: number
      durationMs: number
    }
  | {
      type: 'away_start'
      incidentId: string
      source: AwaySource
      occurredAtMs: number
    }
  | {
      type: 'away_end'
      incidentId: string
      source: 'visibility' | 'focus' | 'cleanup'
      occurredAtMs: number
      durationMs: number
    }
  | {
      type: 'window_exit'
      incidentId: string
      source: 'fullscreen_exit' | 'window_resize'
      occurredAtMs: number
    }
  | {
      type: 'route_exit'
      incidentId: string
      source: string
      occurredAtMs: number
    }

export function createExamIncidentState(): ExamIncidentState {
  return {
    documentVisible: true,
    pendingBlurAtMs: null,
    activeIncident: null,
    recentIncident: null,
    browserIntent: null,
    browserInteraction: null,
  }
}

export function hasCurrentBrowserInteractionIntent(state: ExamIncidentState, atMs: number): boolean {
  const intent = state.browserIntent
  return Boolean(
    intent &&
      atMs >= intent.expiresAtMs - EXAM_BROWSER_CONTEXT_MENU_INTENT_MS &&
      atMs < intent.expiresAtMs
  )
}

function endBrowserInteraction(
  state: ExamIncidentState,
  atMs: number
): { state: ExamIncidentState; effects: ExamIncidentEffect[] } {
  const interaction = state.browserInteraction
  return {
    state: { ...state, browserIntent: null, browserInteraction: null },
    effects: interaction
      ? [
          {
            type: 'browser_interaction_end',
            incidentId: interaction.id,
            occurredAtMs: atMs,
            durationMs: Math.max(0, atMs - interaction.startedAtMs),
          },
        ]
      : [],
  }
}

function appendSignal(incident: ExamIncident, signal: string): ExamIncident {
  if (incident.signals.includes(signal)) return incident
  return { ...incident, signals: [...incident.signals, signal] }
}

function createPointIncident(id: string, atMs: number, signal: string): ExamIncident {
  return {
    id,
    startedAtMs: atMs,
    endedAtMs: atMs,
    awayStartedAtMs: null,
    awaySource: null,
    signals: [signal],
  }
}

function isRecentIncidentReusable(incident: ExamIncident | null, atMs: number): incident is ExamIncident {
  return Boolean(
    incident &&
      incident.endedAtMs !== null &&
      atMs >= incident.endedAtMs &&
      atMs - incident.endedAtMs <= EXAM_INCIDENT_CORRELATION_MS
  )
}

function resolveCorrelatedIncident(
  state: ExamIncidentState,
  atMs: number,
  proposedIncidentId: string,
  signal: string
): { state: ExamIncidentState; incident: ExamIncident } {
  if (state.activeIncident) {
    const incident = appendSignal(state.activeIncident, signal)
    return { state: { ...state, activeIncident: incident }, incident }
  }

  if (isRecentIncidentReusable(state.recentIncident, atMs)) {
    const incident = appendSignal(state.recentIncident, signal)
    return { state: { ...state, recentIncident: incident }, incident }
  }

  const incident = createPointIncident(proposedIncidentId, atMs, signal)
  return { state: { ...state, recentIncident: incident }, incident }
}

function startAwayIncident(
  state: ExamIncidentState,
  options: {
    atMs: number
    proposedIncidentId: string
    source: AwaySource
    signal: string
  }
): { state: ExamIncidentState; incident: ExamIncident } {
  if (state.activeIncident?.awayStartedAtMs !== null && state.activeIncident?.awayStartedAtMs !== undefined) {
    const incident = appendSignal(state.activeIncident, options.signal)
    return { state: { ...state, activeIncident: incident, pendingBlurAtMs: null }, incident }
  }

  const recentIncident = state.recentIncident
  const canReuseRecentPoint =
    isRecentIncidentReusable(recentIncident, options.atMs) &&
    recentIncident.awayStartedAtMs === null &&
    !recentIncident.signals.includes('away')
  const base = canReuseRecentPoint
    ? recentIncident
    : createPointIncident(options.proposedIncidentId, options.atMs, options.signal)
  const incident: ExamIncident = {
    ...appendSignal(appendSignal(base, options.signal), 'away'),
    endedAtMs: null,
    awayStartedAtMs: options.atMs,
    awaySource: options.source,
  }

  return {
    state: {
      ...state,
      pendingBlurAtMs: null,
      activeIncident: incident,
      recentIncident: null,
    },
    incident,
  }
}

function endAwayIncident(
  state: ExamIncidentState,
  atMs: number,
  source: 'visibility' | 'focus' | 'cleanup'
): { state: ExamIncidentState; effects: ExamIncidentEffect[] } {
  const incident = state.activeIncident
  if (!incident || incident.awayStartedAtMs === null) {
    return { state: { ...state, pendingBlurAtMs: null }, effects: [] }
  }

  const ended: ExamIncident = {
    ...incident,
    endedAtMs: atMs,
    awayStartedAtMs: null,
    awaySource: null,
  }
  return {
    state: {
      ...state,
      pendingBlurAtMs: null,
      activeIncident: null,
      recentIncident: ended,
    },
    effects: [
      {
        type: 'away_end',
        incidentId: incident.id,
        source,
        occurredAtMs: atMs,
        durationMs: Math.max(0, atMs - incident.awayStartedAtMs),
      },
    ],
  }
}

function reduceExamIncidentEvent(
  state: ExamIncidentState,
  event: ExamIncidentEvent
): { state: ExamIncidentState; effects: ExamIncidentEffect[] } {
  if (event.type === 'context_menu') {
    const eligible =
      event.hasSelection &&
      event.isCompliant &&
      state.documentVisible &&
      !state.activeIncident &&
      state.pendingBlurAtMs === null &&
      !state.browserInteraction
    return {
      state: {
        ...state,
        browserIntent: eligible
          ? {
              incidentId: event.incidentId,
              expiresAtMs: event.atMs + EXAM_BROWSER_CONTEXT_MENU_INTENT_MS,
            }
          : null,
      },
      effects: [],
    }
  }

  if (event.type === 'cancel_browser_intent') {
    return { state: { ...state, browserIntent: null }, effects: [] }
  }

  if (event.type === 'blur') {
    if (state.browserInteraction) return { state, effects: [] }
    const intent = state.browserIntent
    if (
      intent &&
      hasCurrentBrowserInteractionIntent(state, event.atMs) &&
      event.isCompliant !== false &&
      state.documentVisible &&
      !state.activeIncident &&
      state.pendingBlurAtMs === null
    ) {
      return {
        state: {
          ...state,
          browserIntent: null,
          browserInteraction: { id: intent.incidentId, startedAtMs: event.atMs },
          pendingBlurAtMs: null,
        },
        effects: [],
      }
    }
    state = { ...state, browserIntent: null }
    if (!state.documentVisible || state.activeIncident) return { state, effects: [] }
    return { state: { ...state, pendingBlurAtMs: event.atMs }, effects: [] }
  }

  if (event.type === 'focus') {
    if (!state.documentVisible) {
      return { state: { ...state, pendingBlurAtMs: null }, effects: [] }
    }
    if (
      !state.activeIncident &&
      state.pendingBlurAtMs !== null &&
      event.atMs - state.pendingBlurAtMs >= EXAM_FOCUS_LOSS_GRACE_MS
    ) {
      const startedAtMs = state.pendingBlurAtMs
      const started = startAwayIncident(state, {
        atMs: startedAtMs,
        proposedIncidentId: event.incidentId,
        source: 'blur',
        signal: 'blur',
      })
      const ended = endAwayIncident(started.state, event.atMs, 'focus')
      return {
        state: ended.state,
        effects: [
          {
            type: 'away_start',
            incidentId: started.incident.id,
            source: 'blur',
            occurredAtMs: startedAtMs,
          },
          ...ended.effects,
        ],
      }
    }
    return endAwayIncident(state, event.atMs, 'focus')
  }

  if (event.type === 'blur_timeout') {
    if (!state.documentVisible || state.pendingBlurAtMs === null || state.activeIncident) {
      return { state, effects: [] }
    }
    const startedAtMs = state.pendingBlurAtMs
    const started = startAwayIncident(state, {
      atMs: startedAtMs,
      proposedIncidentId: event.incidentId,
      source: 'blur',
      signal: 'blur',
    })
    return {
      state: started.state,
      effects: [
        {
          type: 'away_start',
          incidentId: started.incident.id,
          source: 'blur',
          occurredAtMs: startedAtMs,
        },
      ],
    }
  }

  if (event.type === 'visibility_hidden') {
    if (!state.documentVisible && state.activeIncident?.signals.includes('visibility_hidden')) {
      return { state, effects: [] }
    }
    const hiddenState = { ...state, documentVisible: false, pendingBlurAtMs: null }
    const started = startAwayIncident(hiddenState, {
      atMs: event.atMs,
      proposedIncidentId: event.incidentId,
      source: 'visibility',
      signal: 'visibility_hidden',
    })
    const alreadyRecordedAway = state.activeIncident?.awayStartedAtMs !== null && state.activeIncident?.awayStartedAtMs !== undefined
    return {
      state: started.state,
      effects: alreadyRecordedAway
        ? []
        : [
            {
              type: 'away_start',
              incidentId: started.incident.id,
              source: 'visibility',
              occurredAtMs: event.atMs,
            },
          ],
    }
  }

  if (event.type === 'visibility_visible') {
    return endAwayIncident(
      { ...state, documentVisible: true, pendingBlurAtMs: null },
      event.atMs,
      'visibility'
    )
  }

  if (event.type === 'window_noncompliant') {
    const resolved = resolveCorrelatedIncident(
      state,
      event.atMs,
      event.incidentId,
      event.source
    )
    return {
      state: resolved.state,
      effects: [
        {
          type: 'window_exit',
          incidentId: resolved.incident.id,
          source: event.source,
          occurredAtMs: event.atMs,
        },
      ],
    }
  }

  if (event.type === 'lifecycle_exit') {
    const resolved = resolveCorrelatedIncident(
      state,
      event.atMs,
      event.incidentId,
      'lifecycle_exit'
    )
    return {
      state: resolved.state,
      effects: [
        {
          type: 'route_exit',
          incidentId: resolved.incident.id,
          source: event.source,
          occurredAtMs: event.atMs,
        },
      ],
    }
  }

  if (event.type === 'route_exit') {
    const incident = createPointIncident(event.incidentId, event.atMs, 'route_exit')
    return {
      state: { ...state, recentIncident: incident },
      effects: [
        {
          type: 'route_exit',
          incidentId: incident.id,
          source: event.source,
          occurredAtMs: event.atMs,
        },
      ],
    }
  }

  const ended = endAwayIncident(state, event.atMs, 'cleanup')
  return {
    state: {
      ...createExamIncidentState(),
      recentIncident: ended.state.recentIncident,
    },
    effects: ended.effects,
  }
}

export function reduceExamIncident(
  state: ExamIncidentState,
  event: ExamIncidentEvent
): { state: ExamIncidentState; effects: ExamIncidentEffect[] } {
  if (
    event.type === 'focus' ||
    event.type === 'visibility_hidden' ||
    event.type === 'window_noncompliant' ||
    event.type === 'route_exit' ||
    event.type === 'lifecycle_exit' ||
    event.type === 'reset'
  ) {
    // Browser UI duration has its own identity and never enters exit correlation.
    const ended = endBrowserInteraction(state, event.atMs)
    const result = reduceExamIncidentEvent(ended.state, event)
    return { state: result.state, effects: [...ended.effects, ...result.effects] }
  }
  return reduceExamIncidentEvent(state, event)
}
