import { describe, expect, it, vi } from 'vitest'
import { isConfirmedAssignmentSave, isConfirmedClassworkRead } from '@/lib/analytics/outcomes'

describe('diagnostic-only outcome confirmation', () => {
  it('confirms explicit empty or owner-scoped Classwork lists', () => {
    expect(isConfirmedClassworkRead({ assignments: [] }, { materials: [] }, { surveys: [] }, 'A')).toBe(true)
    expect(isConfirmedClassworkRead({ assignments: [{ id: 'assignment', classroom_id: 'A' }] }, { materials: [] }, { surveys: [] }, 'A')).toBe(true)
  })
  it.each([null, {}, { assignments: {} }, { assignments: [null] }, { assignments: [{ id: 'row', classroom_id: 'B' }] }])('rejects malformed/unowned read envelope %#', (assignments) => {
    expect(isConfirmedClassworkRead(assignments, { materials: [] }, { surveys: [] }, 'A')).toBe(false)
  })
  it('requires the originating record/classroom on Save and rejects truthy malformed values', () => {
    const owner = { classroomId: 'A', assignmentId: 'original' }
    expect(isConfirmedAssignmentSave({ id: 'original', classroom_id: 'A', is_draft: true }, owner)).toBe(true)
    expect(isConfirmedAssignmentSave({ id: 'replacement', classroom_id: 'A', is_draft: true }, owner)).toBe(false)
    expect(isConfirmedAssignmentSave({ id: 'original', classroom_id: 'B', is_draft: true }, owner)).toBe(false)
    expect(isConfirmedAssignmentSave({}, owner)).toBe(false)
    expect(isConfirmedAssignmentSave(null, owner)).toBe(false)
    expect(isConfirmedAssignmentSave({ id: 'new', classroom_id: 'A', is_draft: true }, { ...owner, assignmentId: null })).toBe(true)
  })
  it('does not execute payload accessors or propagate hostile reflection', () => {
    const getter = vi.fn(() => [])
    expect(isConfirmedClassworkRead(Object.defineProperty({}, 'assignments', { get: getter }), { materials: [] }, { surveys: [] }, 'A')).toBe(false)
    expect(isConfirmedAssignmentSave(new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error('private') } }), { classroomId: 'A', assignmentId: null })).toBe(false)
    expect(getter).not.toHaveBeenCalled()
  })
})
