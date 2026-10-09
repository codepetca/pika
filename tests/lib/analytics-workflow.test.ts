import { afterEach, describe, expect, it, vi } from 'vitest'
import * as client from '@/lib/analytics/client'
import { MAX_DURATION_MS } from '@/lib/analytics/events'
import { createAssignmentWorkflow } from '@/lib/analytics/workflow'

afterEach(() => vi.restoreAllMocks())

describe('assignment workflow telemetry', () => {
  it('starts once and records random, isolated workflow and operation tokens', () => {
    const capture = vi.spyOn(client, 'captureTeacherEvent')
    const first = createAssignmentWorkflow('create')
    first.start()
    first.start()
    first.begin('save').succeed()
    first.begin('post').succeed()
    const second = createAssignmentWorkflow('edit')
    second.start()
    second.begin('schedule').fail('validation')
    expect(capture.mock.calls.map(([event]) => event.name)).toEqual([
      'teacher_workflow_started', 'teacher_action_attempted', 'teacher_action_succeeded',
      'teacher_action_attempted', 'teacher_action_succeeded', 'teacher_workflow_started',
      'teacher_action_attempted', 'teacher_action_failed',
    ])
    const events = capture.mock.calls.map(([event]) => event)
    const firstId = events[0].properties.workflow_id
    expect(firstId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(events.slice(0, 5).every((event) => event.properties.workflow_id === firstId)).toBe(true)
    expect(events[5].properties.workflow_id).not.toBe(firstId)
    expect(events[1].properties.operation_id).not.toBe(events[3].properties.operation_id)
    expect(events[1].properties.operation_id).toBe(events[2].properties.operation_id)
  })

  it('emits only one terminal result and uses monotonic time captured at attempt', () => {
    let now = 100
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const capture = vi.spyOn(client, 'captureTeacherEvent')
    const workflow = createAssignmentWorkflow('edit')
    workflow.start()
    const operation = workflow.begin('save')
    now = 175.5
    operation.fail('persistence')
    operation.succeed()
    operation.fail('unexpected')
    expect(capture).toHaveBeenCalledTimes(3)
    expect(capture.mock.calls[2][0]).toMatchObject({ name: 'teacher_action_failed', properties: { mode: 'edit', action: 'save', duration_ms: 75.5, failure_category: 'persistence' } })
  })

  it('preserves original workflow when a later editor starts while an attempt is pending', () => {
    const capture = vi.spyOn(client, 'captureTeacherEvent')
    const original = createAssignmentWorkflow('edit')
    original.start()
    const pending = original.begin('save')
    createAssignmentWorkflow('create').start()
    pending.succeed()
    expect(capture.mock.calls[3][0].properties).toMatchObject({ workflow_id: capture.mock.calls[0][0].properties.workflow_id, mode: 'edit' })
  })

  it('keeps original workflow properties immutable across capture callbacks', () => {
    const capture = vi.spyOn(client, 'captureTeacherEvent').mockImplementation((event) => {
      Reflect.set(event.properties, 'mode', 'create')
    })
    const original = createAssignmentWorkflow('edit')
    original.start()
    original.begin('save').succeed()
    expect(capture.mock.calls.every(([event]) => 'mode' in event.properties && event.properties.mode === 'edit')).toBe(true)
  })

  it('bounds durations and tolerates clock, random token, and capture failures', () => {
    const capture = vi.spyOn(client, 'captureTeacherEvent')
    const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(MAX_DURATION_MS * 2)
    createAssignmentWorkflow('create').begin('save').succeed()
    expect(capture.mock.calls.at(-1)?.[0].properties.duration_ms).toBe(MAX_DURATION_MS)
    clock.mockImplementation(() => { throw new Error('clock') })
    capture.mockImplementation(() => { throw new Error('telemetry') })
    expect(() => createAssignmentWorkflow('edit').begin('post').fail('unexpected')).not.toThrow()
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('unavailable') })
    capture.mockClear()
    expect(() => createAssignmentWorkflow('create').begin('schedule').succeed()).not.toThrow()
    expect(capture).not.toHaveBeenCalled()
  })

  it('clamps backwards clocks to zero without using wall time', () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(50)
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('wall clock must not be used') })
    const capture = vi.spyOn(client, 'captureTeacherEvent')
    createAssignmentWorkflow('edit').begin('post').succeed()
    expect(capture.mock.calls.at(-1)?.[0]).toMatchObject({ name: 'teacher_action_succeeded', properties: { duration_ms: 0 } })
  })
})
