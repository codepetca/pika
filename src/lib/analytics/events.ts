/** Closed, content-free contracts. Resource, actor, URL and error values have no field here. */
export type TeacherSurface = 'classroom' | 'daily' | 'gradebook' | 'assignments' | 'tests' | 'blueprint' | 'calendar' | 'resources' | 'announcements' | 'roster' | 'settings'
export type AssignmentMode = 'create' | 'edit'
export type AssignmentAction = 'save' | 'post' | 'schedule'
export type FailureCategory = 'validation' | 'persistence' | 'unexpected'

type WorkflowProperties = Readonly<{
  surface: 'assignments'
  workflow: 'assignment'
  mode: AssignmentMode
  workflow_id: string
}>
type OperationProperties = WorkflowProperties & Readonly<{ action: AssignmentAction; operation_id: string }>
type TerminalProperties = OperationProperties & Readonly<{ duration_ms: number }>

export type TeacherAnalyticsEvent =
  | Readonly<{ name: 'teacher_surface_viewed'; properties: Readonly<{ surface: TeacherSurface }> }>
  | Readonly<{ name: 'teacher_surface_ready'; properties: Readonly<{ surface: TeacherSurface; duration_ms: number }> }>
  | Readonly<{ name: 'teacher_surface_failed'; properties: Readonly<{ surface: TeacherSurface; failure_category: FailureCategory }> }>
  | Readonly<{ name: 'teacher_workflow_started'; properties: WorkflowProperties }>
  | Readonly<{ name: 'teacher_action_attempted'; properties: OperationProperties }>
  | Readonly<{ name: 'teacher_action_succeeded'; properties: TerminalProperties }>
  | Readonly<{ name: 'teacher_action_failed'; properties: TerminalProperties & Readonly<{ failure_category: FailureCategory }> }>

export type ValidatedTeacherAnalyticsEvent = TeacherAnalyticsEvent extends infer Event
  ? Event extends TeacherAnalyticsEvent
    ? Readonly<{ name: Event['name']; properties: Event['properties'] & Readonly<{ schema_version: 1 }> }>
    : never
  : never

// Six hours is ample for a single editor mutation; larger/invalid durations are rejected.
export const MAX_DURATION_MS = 6 * 60 * 60 * 1000

const surfaces: readonly TeacherSurface[] = ['classroom', 'daily', 'gradebook', 'assignments', 'tests', 'blueprint', 'calendar', 'resources', 'announcements', 'roster', 'settings']
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const workflowKeys = ['surface', 'workflow', 'mode', 'workflow_id']
const operationKeys = [...workflowKeys, 'action', 'operation_id']

/** Inspect descriptors, never invoke getters or spread caller-controlled objects. */
function ownData(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return null
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null
  const result: Record<string, unknown> = Object.create(null)
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) return null
    result[key] = descriptor.value
  }
  return result
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.includes(value as T)
}

function randomToken(value: unknown): value is string {
  return typeof value === 'string' && uuidV4.test(value)
}

function boundedDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_DURATION_MS
}

function validated<Event extends TeacherAnalyticsEvent>(event: Event): ValidatedTeacherAnalyticsEvent {
  // Only locally constructed, validated primitives reach this spread.
  return Object.freeze({ name: event.name, properties: Object.freeze({ ...event.properties, schema_version: 1 as const }) }) as ValidatedTeacherAnalyticsEvent
}

/** Invalid input is dropped as a whole, including any additional field. */
export function validateTeacherAnalyticsEvent(input: unknown): ValidatedTeacherAnalyticsEvent | null {
  try {
    const event = ownData(input, ['name', 'properties'])
    if (!event) return null
    if (event.name === 'teacher_surface_viewed' || event.name === 'teacher_surface_ready' || event.name === 'teacher_surface_failed') {
      const keys = event.name === 'teacher_surface_viewed' ? ['surface']
        : event.name === 'teacher_surface_ready' ? ['surface', 'duration_ms'] : ['surface', 'failure_category']
      const properties = ownData(event.properties, keys)
      if (!properties || !enumValue(properties.surface, surfaces)) return null
      if (event.name === 'teacher_surface_viewed') return validated({ name: event.name, properties: { surface: properties.surface } })
      if (event.name === 'teacher_surface_ready') {
        if (!boundedDuration(properties.duration_ms)) return null
        return validated({ name: event.name, properties: { surface: properties.surface, duration_ms: properties.duration_ms } })
      }
      if (!enumValue(properties.failure_category, ['validation', 'persistence', 'unexpected'])) return null
      return validated({ name: event.name, properties: { surface: properties.surface, failure_category: properties.failure_category } })
    }
    if (!enumValue(event.name, ['teacher_workflow_started', 'teacher_action_attempted', 'teacher_action_succeeded', 'teacher_action_failed'])) return null
    const keys = event.name === 'teacher_workflow_started' ? workflowKeys
      : event.name === 'teacher_action_attempted' ? operationKeys
        : event.name === 'teacher_action_succeeded' ? [...operationKeys, 'duration_ms']
          : [...operationKeys, 'duration_ms', 'failure_category']
    const properties = ownData(event.properties, keys)
    if (!properties || properties.surface !== 'assignments' || properties.workflow !== 'assignment'
      || !enumValue(properties.mode, ['create', 'edit']) || !randomToken(properties.workflow_id)) return null
    const workflow: WorkflowProperties = { surface: 'assignments', workflow: 'assignment', mode: properties.mode, workflow_id: properties.workflow_id }
    if (event.name === 'teacher_workflow_started') return validated({ name: event.name, properties: workflow })
    if (!enumValue(properties.action, ['save', 'post', 'schedule']) || !randomToken(properties.operation_id)) return null
    const operation: OperationProperties = { ...workflow, action: properties.action, operation_id: properties.operation_id }
    if (event.name === 'teacher_action_attempted') return validated({ name: event.name, properties: operation })
    if (!boundedDuration(properties.duration_ms)) return null
    const terminal: TerminalProperties = { ...operation, duration_ms: properties.duration_ms }
    if (event.name === 'teacher_action_succeeded') return validated({ name: event.name, properties: terminal })
    if (!enumValue(properties.failure_category, ['validation', 'persistence', 'unexpected'])) return null
    return validated({ name: event.name, properties: { ...terminal, failure_category: properties.failure_category } })
  } catch {
    // Proxies may throw during reflection. Never inspect or report the caught value.
    return null
  }
}
