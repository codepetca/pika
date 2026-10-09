import { validateTeacherAnalyticsEvent, type TeacherAnalyticsEvent, type ValidatedTeacherAnalyticsEvent } from './events'

export type TeacherAnalyticsPolicy = Readonly<{
  enabled?: boolean
  explicitConsent?: boolean
  teacherContext?: boolean
  approvedCohort?: boolean
}>

export type TeacherAnalyticsTransport = Readonly<{
  capture(event: ValidatedTeacherAnalyticsEvent, signal: AbortSignal): void | Promise<void>
}>

/** Synthetic injection seam only; no application configuration or vendor adapter exists. */
export function createTeacherAnalyticsClient(options: TeacherAnalyticsPolicy & { transport?: TeacherAnalyticsTransport } = {}) {
  const transport = options.transport
  let controller: AbortController | null = null

  function disable(): void {
    controller?.abort()
    controller = null
  }

  function setPolicy(policy: TeacherAnalyticsPolicy): void {
    disable()
    if (policy.enabled === true && policy.explicitConsent === true
      && policy.teacherContext === true && policy.approvedCohort === true) {
      controller = new AbortController()
    }
  }

  function capture(event: TeacherAnalyticsEvent): void {
    const generation = controller
    if (!generation || !transport) return
    const safeEvent = validateTeacherAnalyticsEvent(event)
    if (!safeEvent || controller !== generation || generation.signal.aborted) return
    try {
      // Deliver immediately. Nothing is buffered or retried after policy changes.
      const delivery = transport.capture(safeEvent, generation.signal)
      if (delivery) void Promise.resolve(delivery).catch(() => {})
    } catch {
      // Telemetry cannot change the outcome of the teacher's action.
    }
  }

  setPolicy(options)
  return { capture, setPolicy, disable }
}

/** Permanently inert in this slice. Live collection requires a separately reviewed implementation. */
export function captureTeacherEvent(_event: TeacherAnalyticsEvent): void {}
