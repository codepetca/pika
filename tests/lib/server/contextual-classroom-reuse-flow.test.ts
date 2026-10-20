import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyBlueprintMergeSuggestions, getBlueprintMergeSuggestionSet } from '@/lib/server/course-sites'
import { makeQueryBuilder } from '../../support/supabase'
const mocks = vi.hoisted(() => ({ detail: vi.fn(), source: vi.fn(), submit: vi.fn(), snapshot: vi.fn() }))
let supabase: any
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => supabase }))
vi.mock('@/lib/server/course-blueprints', () => ({ getCourseBlueprintDetail: mocks.detail }))
vi.mock('@/lib/server/classroom-blueprint-source', () => ({ loadClassroomBlueprintSource: mocks.source }))
vi.mock('@/lib/server/course-blueprint-proposals', () => ({ submitCourseBlueprintProposal: mocks.submit }))
vi.mock('@/lib/server/course-blueprint-versions', () => ({ buildCourseBlueprintSnapshot: mocks.snapshot }))

describe('admitted archived reuse comparison and manual review', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detail.mockResolvedValue({ detail: {
      id: 'b-1', content_revision: 7, authority_mode: 'pika', title: 'Course',
      overview_markdown: 'Old', outline_markdown: 'Keep outline', resources_markdown: '',
      assignments: [], assessments: [], lesson_templates: [], materials: [], surveys: [],
    } })
    mocks.source.mockResolvedValue({ ok: true, source: {
      classroom: { id: 'c-1', title: 'Class', source_blueprint_id: 'b-1', blueprint_source_revision: 2, course_overview_markdown: 'New', course_outline_markdown: 'Unselected' },
      resources_markdown: '', assignments: [], tests: [], lesson_templates: [], materials: [], surveys: [], announcements: [],
    } })
    mocks.submit.mockResolvedValue({ ok: true, proposal: { status: 'needs_review' } })
    mocks.snapshot.mockImplementation((detail) => detail)
    supabase = { from: vi.fn(() => makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'owner', content_revision: 7 } })) }
  })
  it.each([
    { teacher_id: 'other' }, { content_revision: 8 },
  ])('rejects Blueprint changes during source reads %j', async (change) => {
    supabase = { from: vi.fn(() => makeQueryBuilder({ data: { id: 'b-1', teacher_id: 'owner', content_revision: 7, ...change } })) }
    expect(await getBlueprintMergeSuggestionSet('owner', 'b-1', 'c-1', { archivedReuse: true })).toMatchObject({ ok: false, status: 409 })
    expect(await applyBlueprintMergeSuggestions('owner', 'b-1', 'c-1', ['overview'], { expectedBlueprintRevision: 7, expectedClassroomRevision: 2 }, { archivedReuse: true })).toMatchObject({ ok: false, status: 409 })
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('uses admitted archive checks and submits only selected areas through the normal proposal writer', async () => {
    await expect(applyBlueprintMergeSuggestions('owner', 'b-1', 'c-1', ['overview'], { expectedBlueprintRevision: 7, expectedClassroomRevision: 2 }, { archivedReuse: true })).resolves.toMatchObject({ ok: true })
    expect(mocks.source).toHaveBeenCalledWith('owner', 'c-1', { lessonTemplateTitleMode: 'generic', archivedReuse: { blueprintId: 'b-1' } })
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ source: 'classroom', sourceClassroomId: 'c-1', candidate: expect.objectContaining({ overview_markdown: 'New', outline_markdown: 'Keep outline' }) }))
  })
  it('passes the guarded legacy active allowance through both comparison and selected-area review', async () => {
    await expect(getBlueprintMergeSuggestionSet('owner', 'b-1', 'c-1', { archivedReuse: true, allowActiveLegacy: true })).resolves.toMatchObject({ ok: true })
    await expect(applyBlueprintMergeSuggestions('owner', 'b-1', 'c-1', ['overview'], { expectedBlueprintRevision: 7, expectedClassroomRevision: 2 }, { archivedReuse: true, allowActiveLegacy: true })).resolves.toMatchObject({ ok: true })
    expect(mocks.source).toHaveBeenNthCalledWith(1, 'owner', 'c-1', { lessonTemplateTitleMode: 'generic', archivedReuse: { blueprintId: 'b-1', allowActiveLegacy: true } })
    expect(mocks.source).toHaveBeenNthCalledWith(2, 'owner', 'c-1', { lessonTemplateTitleMode: 'generic', archivedReuse: { blueprintId: 'b-1', allowActiveLegacy: true } })
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ candidate: expect.objectContaining({ overview_markdown: 'New', outline_markdown: 'Keep outline' }) }))
  })
  it('retains repository authority as terminal before source or proposal writes', async () => {
    mocks.detail.mockResolvedValue({ detail: { content_revision: 7, authority_mode: 'repository' } })
    expect(await applyBlueprintMergeSuggestions('owner', 'b-1', 'c-1', ['overview'], { expectedBlueprintRevision: 7, expectedClassroomRevision: 2 }, { archivedReuse: true })).toMatchObject({ ok: false, status: 409 })
    expect(mocks.source).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
  })
})
