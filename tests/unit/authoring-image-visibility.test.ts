import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memberCanReadAuthoringImage, authoringImageUrl } from '@/lib/server/authoring-images'
import { getServiceRoleClient } from '@/lib/supabase'
import { getTestStudentAvailabilityState } from '@/lib/server/tests'
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/tests', async original => ({ ...await original<typeof import('@/lib/server/tests')>(), getTestStudentAvailabilityState: vi.fn() }))
const classroomId = 'classroom-1', studentId = 'student-1', id = '11111111-1111-4111-8111-111111111111', url = authoringImageUrl(id)
let rows: Record<string, unknown[]>, failures: Set<string>, filters: Array<[string,string,unknown]>
beforeEach(() => {
 vi.clearAllMocks();rows = {};failures = new Set();filters = []
 vi.mocked(getTestStudentAvailabilityState).mockResolvedValue({ state: null, missingTable: false, error: null })
 vi.mocked(getServiceRoleClient).mockReturnValue({ from: (table: string) => {
  const result = () => ({ data: rows[table] || [], error: failures.has(table) ? { message: 'unavailable' } : null })
  const query = { select: () => query, eq: (column: string, value: unknown) => { filters.push([table,column,value]);return query }, ilike: () => query, limit: () => query, maybeSingle: async () => ({ ...result(), data: result().data[0] || null }), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) };return query
 } } as never)
})
describe('published authoring image visibility', () => {
 it('does not grant access simply from membership or a known object id', async () => {
  expect(await memberCanReadAuthoringImage(classroomId, studentId, id)).toBe(false)
  expect(filters).toContainEqual(['assignments','classroom_id',classroomId]);expect(filters).toContainEqual(['assignments','is_draft',false]);expect(filters).toContainEqual(['classwork_materials','is_draft',false])
 })
 it('grants an exact image reference from published assignment or Material source', async () => {
  rows.assignments = [{ instructions_markdown: `![Diagram](${url})` }]
  expect(await memberCanReadAuthoringImage(classroomId, studentId, id)).toBe(true)
  rows.assignments = [];rows.classwork_materials = [{ content: { attrs: { authoring_markdown: `![Diagram](${url})` } } }]
  expect(await memberCanReadAuthoringImage(classroomId, studentId, id)).toBe(true)
 })
 it('ignores stale compatibility images when Material source removes them', async () => {
  rows.classwork_materials = [{ content: { attrs: { authoring_markdown: 'Image removed' }, content: [{ type: 'image', attrs: { src: url } }] } }]
  expect(await memberCanReadAuthoringImage(classroomId, studentId, id)).toBe(false)
 })
 it('does not leak future or closed Survey images to a nonrespondent', async () => {
  rows.survey_questions = [{ question_text: `![Diagram](${url})`, surveys: { id: 'survey-1', classroom_id: classroomId, status: 'active', opens_at: '2099-01-01T00:00:00Z', show_results: false } }]
  expect(await memberCanReadAuthoringImage(classroomId, studentId, id)).toBe(false)
  rows.survey_responses = [{ question_id: 'question-1' }]
  expect(await memberCanReadAuthoringImage(classroomId, studentId, id)).toBe(true)
  expect(filters).toContainEqual(['survey_responses','student_id',studentId])
 })
 it('follows individual Test availability and existing submitted access', async () => {
  rows.test_questions = [{ question_text: `![Diagram](${url})`, tests: { id: 'test-1', classroom_id: classroomId, status: 'closed' } }]
  expect(await memberCanReadAuthoringImage(classroomId, studentId, id)).toBe(false)
  vi.mocked(getTestStudentAvailabilityState).mockResolvedValue({ state: 'open', missingTable: false, error: null })
  expect(await memberCanReadAuthoringImage(classroomId, studentId, id)).toBe(true)
  vi.mocked(getTestStudentAvailabilityState).mockResolvedValue({ state: 'closed', missingTable: false, error: null })
  rows.test_attempts = [{ is_submitted: true, returned_at: null, closed_for_grading_at: null }]
  expect(await memberCanReadAuthoringImage(classroomId, studentId, id)).toBe(true)
  expect(filters).toContainEqual(['test_attempts','student_id',studentId])
 })
 it('fails closed if publication evidence cannot be read', async () => {
  rows.assignments = [{ instructions_markdown: url }];failures.add('test_questions')
  await expect(memberCanReadAuthoringImage(classroomId, studentId, id)).rejects.toThrow('Unable to verify image access')
 })
})
