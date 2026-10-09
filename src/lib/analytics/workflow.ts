import { captureTeacherEvent } from './client'
import { MAX_DURATION_MS, type AssignmentAction, type AssignmentMode, type FailureCategory, type TeacherAnalyticsEvent } from './events'

function token(): string | null {
  try {
    return globalThis.crypto.randomUUID()
  } catch {
    return null
  }
}

function monotonicNow(): number {
  try {
    const value = globalThis.performance.now()
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

function capture(event: TeacherAnalyticsEvent): void {
  try {
    Object.freeze(event.properties)
    captureTeacherEvent(Object.freeze(event))
  } catch {
    // A telemetry failure must never interrupt authoring or persistence.
  }
}

/** One short-lived editor instance owns its random workflow token and operation closures. */
export function createAssignmentWorkflow(mode: AssignmentMode) {
  const workflowId = token()
  const workflow = { surface: 'assignments' as const, workflow: 'assignment' as const, mode, workflow_id: workflowId ?? '' }
  let started = false

  function start(): void {
    if (started) return
    started = true
    if (workflowId) capture({ name: 'teacher_workflow_started', properties: workflow })
  }

  function begin(action: AssignmentAction) {
    start()
    const operationId = token()
    const attemptedAt = monotonicNow()
    const operation = { ...workflow, action, operation_id: operationId ?? '' }
    let completed = false
    if (workflowId && operationId) capture({ name: 'teacher_action_attempted', properties: operation })

    function finish(category?: FailureCategory): void {
      if (completed) return
      completed = true
      if (!workflowId || !operationId) return
      const duration = Math.min(MAX_DURATION_MS, Math.max(0, monotonicNow() - attemptedAt))
      if (category) capture({ name: 'teacher_action_failed', properties: { ...operation, duration_ms: duration, failure_category: category } })
      else capture({ name: 'teacher_action_succeeded', properties: { ...operation, duration_ms: duration } })
    }

    return { succeed: () => finish(), fail: (category: FailureCategory) => finish(category) }
  }

  return { start, begin }
}
