import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureTeacherEvent, createTeacherAnalyticsClient } from '@/lib/analytics/client'
import { MAX_DURATION_MS, validateTeacherAnalyticsEvent, type TeacherAnalyticsEvent } from '@/lib/analytics/events'

const policy = { enabled: true, explicitConsent: true, teacherContext: true, approvedCohort: true }
const viewed: TeacherAnalyticsEvent = { name: 'teacher_surface_viewed', properties: { surface: 'assignments' } }
const workflowId = '12345678-1234-4234-8234-123456789abc'
const operationId = '87654321-1234-4234-8234-123456789abc'
const failed: TeacherAnalyticsEvent = {
  name: 'teacher_action_failed',
  properties: { surface: 'assignments', workflow: 'assignment', mode: 'create', action: 'save', workflow_id: workflowId, operation_id: operationId, duration_ms: 120, failure_category: 'persistence' },
}

afterEach(() => vi.restoreAllMocks())

describe('inert teacher analytics adapter', () => {
  it('keeps the application singleton inert without touching event values or network APIs', () => {
    const getter = vi.fn(() => { throw new Error('must not inspect') })
    const network = vi.spyOn(globalThis, 'fetch')
    const event = Object.defineProperty({}, 'name', { get: getter }) as TeacherAnalyticsEvent
    expect(() => captureTeacherEvent(event)).not.toThrow()
    expect(getter).not.toHaveBeenCalled()
    expect(network).not.toHaveBeenCalled()
  })

  it('defaults disabled and never initializes a transport', () => {
    const capture = vi.fn()
    const client = createTeacherAnalyticsClient({ transport: { capture } })
    client.capture(viewed)
    expect(capture).not.toHaveBeenCalled()
    expect(() => createTeacherAnalyticsClient(policy).capture(viewed)).not.toThrow()
  })

  it.each(['enabled', 'explicitConsent', 'teacherContext', 'approvedCohort'] as const)('requires explicit %s approval', (key) => {
    const capture = vi.fn()
    const client = createTeacherAnalyticsClient({ ...policy, [key]: false, transport: { capture } })
    client.capture(viewed)
    expect(capture).not.toHaveBeenCalled()
  })

  it('delivers a fresh frozen allowlisted event with a schema version', () => {
    const capture = vi.fn()
    const client = createTeacherAnalyticsClient({ ...policy, transport: { capture } })
    client.capture(failed)
    const [event, signal] = capture.mock.calls[0]
    expect(event).toEqual({ name: failed.name, properties: { ...failed.properties, schema_version: 1 } })
    expect(event).not.toBe(failed)
    expect(Object.isFrozen(event)).toBe(true)
    expect(Object.isFrozen(event.properties)).toBe(true)
    expect(signal.aborted).toBe(false)
  })

  it('drops invalid events at the transport boundary without reading accessors', () => {
    const capture = vi.fn()
    const getter = vi.fn(() => 'assignments')
    const client = createTeacherAnalyticsClient({ ...policy, transport: { capture } })
    client.capture({ ...viewed, properties: { ...viewed.properties, classroom_id: workflowId } } as TeacherAnalyticsEvent)
    client.capture({ name: 'teacher_surface_viewed', properties: Object.defineProperty({}, 'surface', { get: getter }) } as TeacherAnalyticsEvent)
    expect(capture).not.toHaveBeenCalled()
    expect(getter).not.toHaveBeenCalled()
  })

  it('fences a policy change that occurs during input validation', () => {
    const capture = vi.fn()
    const client = createTeacherAnalyticsClient({ ...policy, transport: { capture } })
    const event = new Proxy(viewed, {
      ownKeys(target) {
        client.disable()
        return Reflect.ownKeys(target)
      },
    })
    client.capture(event)
    expect(capture).not.toHaveBeenCalled()
  })

  it('drops disabled events and fences pending transport without replay after enabling', () => {
    const capture = vi.fn(() => new Promise<void>(() => {}))
    const client = createTeacherAnalyticsClient({ transport: { capture } })
    client.capture(viewed)
    client.setPolicy(policy)
    expect(capture).not.toHaveBeenCalled()
    client.capture(viewed)
    const signal = capture.mock.calls[0][1]
    client.disable()
    expect(signal.aborted).toBe(true)
    client.capture(viewed)
    client.setPolicy(policy)
    expect(capture).toHaveBeenCalledTimes(1)
    client.capture(viewed)
    expect(capture).toHaveBeenCalledTimes(2)
  })

  it('contains synchronous and asynchronous transport failures', async () => {
    const sync = createTeacherAnalyticsClient({ ...policy, transport: { capture: () => { throw new Error('private failure') } } })
    const asyncClient = createTeacherAnalyticsClient({ ...policy, transport: { capture: () => Promise.reject(new Error('private failure')) } })
    expect(() => sync.capture(viewed)).not.toThrow()
    expect(() => asyncClient.capture(viewed)).not.toThrow()
    await Promise.resolve()
  })

  it('contains hostile input reflection failures', () => {
    const event = new Proxy({}, { ownKeys: () => { throw new Error('hostile input') } })
    expect(validateTeacherAnalyticsEvent(event)).toBeNull()
  })

  it('has no vendor runtime import, initialization, environment lookup, or browser persistence', () => {
    for (const file of ['client.ts', 'events.ts', 'workflow.ts']) {
      const source = readFileSync(new URL(`../../src/lib/analytics/${file}`, import.meta.url), 'utf8')
      expect(source).not.toMatch(/posthog|process\.env|localStorage|sessionStorage|document\.cookie|fetch\s*\(/i)
    }
  })
})

describe('content-free runtime event validation', () => {
  it('accepts each finite event contract', () => {
    const { duration_ms: _duration, failure_category: _category, ...operation } = failed.properties
    const { action: _action, operation_id: _operation, ...workflow } = operation
    const events: TeacherAnalyticsEvent[] = [
      viewed,
      { name: 'teacher_surface_ready', properties: { surface: 'classroom', duration_ms: 50 } },
      { name: 'teacher_surface_failed', properties: { surface: 'assignments', failure_category: 'persistence' } },
      { name: 'teacher_workflow_started', properties: workflow },
      { name: 'teacher_action_attempted', properties: operation },
      { name: 'teacher_action_succeeded', properties: { ...operation, duration_ms: 0 } },
      failed,
    ]
    for (const event of events) expect(validateTeacherAnalyticsEvent(event)).not.toBeNull()
  })

  it.each([
    { name: 'unknown', properties: { surface: 'assignments' } },
    { name: 'teacher_surface_ready', properties: { surface: 'classroom', duration_ms: MAX_DURATION_MS + 1 } },
    { name: 'teacher_surface_failed', properties: { surface: 'assignments', failure_category: 'message' } },
    { name: 'teacher_surface_failed', properties: { surface: 'assignments', failure_category: 'persistence', duration_ms: 5 } },
    { ...viewed, extra: 'secret' },
    { ...viewed, properties: { surface: 'assignments', email: 'private@example.invalid' } },
    { ...viewed, properties: { surface: 'arbitrary route' } },
    { ...viewed, properties: { surface: 'assignments', schema_version: 1 } },
    { ...failed, properties: { ...failed.properties, mode: 'unknown' } },
    { ...failed, properties: { ...failed.properties, workflow: 'student' } },
    { ...failed, properties: { ...failed.properties, action: 'delete' } },
    { ...failed, properties: { ...failed.properties, failure_category: 'raw error' } },
    { ...failed, properties: { ...failed.properties, workflow_id: 'classroom-123' } },
    { ...failed, properties: { ...failed.properties, operation_id: workflowId.replace('-4', '-1') } },
    ...[-1, Infinity, NaN, MAX_DURATION_MS + 1, '120'].map((duration_ms) => ({ ...failed, properties: { ...failed.properties, duration_ms } })),
    { name: 'teacher_action_failed', properties: {} },
    { ...failed, properties: { ...failed.properties, error: new Error('private') } },
    { ...viewed, properties: Object.assign(Object.create({ secret: 'private' }), { surface: 'assignments' }) },
    null,
  ])('rejects unknown names, extra keys, unsafe values and missing fields %#', (event) => {
    expect(validateTeacherAnalyticsEvent(event)).toBeNull()
  })

  it('rejects accessors and symbol keys without executing getters or inspecting errors', () => {
    const getter = vi.fn(() => 'assignments')
    const properties = Object.defineProperty({}, 'surface', { enumerable: true, get: getter })
    expect(validateTeacherAnalyticsEvent({ name: viewed.name, properties })).toBeNull()
    expect(validateTeacherAnalyticsEvent({ ...viewed, properties: { ...viewed.properties, [Symbol('private')]: 'secret' } })).toBeNull()
    const error = Object.defineProperty({}, 'message', { get: getter })
    expect(validateTeacherAnalyticsEvent({ ...viewed, properties: { ...viewed.properties, error } })).toBeNull()
    expect(getter).not.toHaveBeenCalled()
  })
})
