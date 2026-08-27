import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getClassroomCourseGuide, getPublishedCourseGuide } from '@/lib/server/course-guide'

const mocks = vi.hoisted(() => ({
  getClassroomActualCourseSite: vi.fn(),
  getPublishedActualCourseSite: vi.fn(),
}))

vi.mock('@/lib/server/course-sites', () => ({
  getClassroomActualCourseSite: mocks.getClassroomActualCourseSite,
  getPublishedActualCourseSite: mocks.getPublishedActualCourseSite,
}))

describe('getPublishedCourseGuide', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a public-safe guide from the current published classroom projection', async () => {
    mocks.getPublishedActualCourseSite.mockResolvedValue({
      ok: true,
      site: {
        classroom: {
          id: 'classroom-1',
          title: 'Computer Science',
          class_code: 'ICS4U',
          term_label: 'Semester 1',
          start_date: '2026-09-03',
          end_date: '2027-01-29',
          actual_site_config: {
            overview: true,
            outline: true,
            resources: true,
            assignments: true,
            tests: true,
            lesson_plans: true,
            announcements: true,
            lesson_plan_scope: 'current_week',
          },
          course_overview_markdown: 'Overview',
          course_outline_markdown: 'Outline',
        },
        resources: {
          content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ministry link' }] }],
          },
        },
        resources_markdown: 'Ministry link',
        assignments: [{
          title: 'Portfolio',
          instructions_markdown: 'Build it.',
          due_at: '2026-10-15T03:59:00.000Z',
          points_possible: 30,
          include_in_final: true,
          position: 0,
        }],
        tests: [{
          title: 'Unit test',
          points_possible: 50,
          include_in_final: true,
          position: 0,
          content: { questions: [{ answer_key: 'private answer' }] },
          documents: [
            { id: 'd1', source: 'link', title: 'Review', url: 'https://example.com/review' },
            { id: 'd2', source: 'link', title: 'Unsafe', url: 'javascript:alert(1)' },
            { id: 'd3', source: 'upload', title: 'Private upload', storage_path: 'private/file.pdf' },
          ],
        }],
        grading: {
          items: [
            { category: 'assignments', title: 'Portfolio', course_weight_percent: 25 },
            { category: 'tests', title: 'Unit test', course_weight_percent: 75 },
          ],
        },
        lesson_plans: [{ date: '2026-09-10', content_markdown: 'Variables' }],
        announcements: [{
          id: 'announcement-1',
          title: 'Welcome',
          content: 'Bring your laptop.',
          scheduled_for: null,
          created_at: '2026-09-01T14:00:00.000Z',
        }],
      },
    })

    const result = await getPublishedCourseGuide('computer-science')

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      guide: expect.objectContaining({
        classroom: expect.objectContaining({ title: 'Computer Science', classCode: 'ICS4U' }),
        assignments: [expect.objectContaining({ title: 'Portfolio', courseWeightPercent: 25 })],
        tests: [expect.objectContaining({
          title: 'Unit test',
          courseWeightPercent: 75,
          documents: [{
            key: 'test-document:0:d1',
            title: 'Review',
            href: 'https://example.com/review',
          }],
        })],
        lessonPlans: [expect.objectContaining({ date: '2026-09-10' })],
        announcements: [expect.objectContaining({ title: 'Welcome' })],
      }),
    }))
    expect(JSON.stringify(result)).not.toContain('private answer')
    expect(JSON.stringify(result)).not.toContain('private/file.pdf')
    expect(JSON.stringify(result)).not.toContain('javascript:')
  })

  it('does not disclose classroom content from disabled guide sections', async () => {
    mocks.getPublishedActualCourseSite.mockResolvedValue({
      ok: true,
      site: {
        classroom: {
          title: 'Computer Science',
          class_code: 'ICS4U',
          term_label: null,
          start_date: null,
          end_date: null,
          actual_site_config: {
            overview: false,
            outline: false,
            resources: false,
            assignments: false,
            tests: false,
            lesson_plans: false,
            announcements: false,
            lesson_plan_scope: 'current_week',
          },
          course_overview_markdown: 'Hidden overview',
          course_outline_markdown: 'Hidden outline',
        },
        resources: { content: { type: 'doc', content: [{ type: 'text', text: 'Hidden resource' }] } },
        assignments: [{ title: 'Hidden assignment' }],
        tests: [{ title: 'Hidden test' }],
        grading: null,
        lesson_plans: [{ date: '2026-09-10', content_markdown: 'Hidden lesson' }],
        announcements: [{
          id: 'hidden-announcement',
          title: 'Hidden announcement',
          content: 'Hidden content',
          scheduled_for: null,
          created_at: '2026-09-01T14:00:00.000Z',
        }],
      },
    })

    const result = await getPublishedCourseGuide('computer-science')

    expect(result).toEqual({
      ok: true,
      guide: expect.objectContaining({
        overviewMarkdown: '',
        outlineMarkdown: '',
        resourcesContent: null,
        assignments: [],
        tests: [],
        lessonPlans: [],
        announcements: [],
      }),
    })
    expect(JSON.stringify(result)).not.toContain('Hidden')
  })

  it('preserves the published-site not-found contract', async () => {
    mocks.getPublishedActualCourseSite.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Actual course site not found',
    })

    await expect(getPublishedCourseGuide('missing')).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'Actual course site not found',
    })
  })

  it('builds the same safe projection directly from an authenticated classroom', async () => {
    mocks.getClassroomActualCourseSite.mockResolvedValue({
      ok: true,
      site: {
        classroom: {
          title: 'Private Computer Science',
          class_code: 'ICS4U',
          term_label: null,
          start_date: null,
          end_date: null,
          actual_site_config: {
            overview: true,
            outline: true,
            resources: true,
            assignments: true,
            tests: true,
            lesson_plans: true,
            announcements: true,
            lesson_plan_scope: 'current_week',
          },
          course_overview_markdown: 'Private classroom overview',
          course_outline_markdown: '',
        },
        resources: null,
        assignments: [],
        tests: [],
        grading: null,
        lesson_plans: [],
        announcements: [],
      },
    })

    const result = await getClassroomCourseGuide('classroom-1')

    expect(mocks.getClassroomActualCourseSite).toHaveBeenCalledWith('classroom-1')
    expect(result).toEqual({
      ok: true,
      guide: expect.objectContaining({
        classroom: expect.objectContaining({ title: 'Private Computer Science' }),
        overviewMarkdown: 'Private classroom overview',
      }),
    })
  })
})
