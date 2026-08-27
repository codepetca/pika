import {
  getClassroomActualCourseSite,
  getPublishedActualCourseSite,
  type PublishedActualCourseSiteData,
} from '@/lib/server/course-sites'
import { isEmpty, parseContentField } from '@/lib/tiptap-content'
import type {
  CourseGuideData,
  CourseGuideDocumentLink,
} from '@/lib/course-guide'
import type { PublishedCourseSiteGradingItem } from '@/lib/server/course-sites'
import type { TestDocument } from '@/types'

function getGradingItem(
  items: PublishedCourseSiteGradingItem[],
  key: string,
) {
  return items.find((item) => item.key === key) ?? null
}

function getPublicDocumentLinks(
  documents: unknown,
  testPosition: number,
): CourseGuideDocumentLink[] {
  if (!Array.isArray(documents)) return []

  return (documents as TestDocument[]).flatMap((document, index) => {
    if (document.source !== 'link' || !document.url?.trim()) return []

    let href: string
    try {
      const parsed = new URL(document.url.trim())
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return []
      href = parsed.href
    } catch {
      return []
    }

    return [{
      key: `test-document:${testPosition}:${document.id || index}`,
      title: document.title?.trim() || `Document ${index + 1}`,
      href,
    }]
  })
}

export async function getPublishedCourseGuide(
  slug: string,
): Promise<
  | { ok: true; guide: CourseGuideData }
  | { ok: false; status: number; error: string }
> {
  const result = await getPublishedActualCourseSite(slug)
  if (!result.ok) return result

  return { ok: true, guide: buildCourseGuide(result.site) }
}

export async function getClassroomCourseGuide(
  classroomId: string,
): Promise<
  | { ok: true; guide: CourseGuideData }
  | { ok: false; status: number; error: string }
> {
  const result = await getClassroomActualCourseSite(classroomId)
  if (!result.ok) return result

  return { ok: true, guide: buildCourseGuide(result.site) }
}

function buildCourseGuide(site: PublishedActualCourseSiteData): CourseGuideData {
  const { classroom, resources, assignments, tests, grading, lesson_plans, announcements } = site
  const visibility = classroom.actual_site_config
  const gradingItems = grading?.items ?? []
  const resourcesContent = resources?.content ? parseContentField(resources.content) : null

  return {
    classroom: {
      title: classroom.title,
      classCode: classroom.class_code,
    },
    visibility,
    overviewMarkdown: visibility.overview ? classroom.course_overview_markdown : '',
    resourcesContent: visibility.resources && resourcesContent && !isEmpty(resourcesContent)
      ? resourcesContent
      : null,
    assignments: visibility.assignments ? assignments.map((assignment, index) => {
      const gradingKey = `assignment:${assignment.position ?? index}:${assignment.title}`
      const gradingItem = getGradingItem(gradingItems, gradingKey)
      return {
        key: `assignment:${assignment.position ?? index}:${assignment.title || index}`,
        title: String(assignment.title || 'Untitled assignment'),
        instructionsMarkdown: String(assignment.instructions_markdown || ''),
        dueAt: typeof assignment.due_at === 'string' ? assignment.due_at : null,
        pointsPossible: typeof assignment.points_possible === 'number' ? assignment.points_possible : null,
        includeInFinal: assignment.include_in_final !== false,
        courseWeightPercent: gradingItem?.course_weight_percent ?? null,
        position: Number(assignment.position ?? index),
      }
    }) : [],
    tests: visibility.tests ? tests.map((test, index) => {
      const position = Number(test.position ?? index)
      const gradingKey = `test:${test.position ?? index}:${test.title}`
      const gradingItem = getGradingItem(gradingItems, gradingKey)
      return {
        key: `test:${position}:${test.title || index}`,
        title: String(test.title || 'Untitled test'),
        pointsPossible: typeof test.points_possible === 'number' ? test.points_possible : null,
        includeInFinal: test.include_in_final !== false,
        courseWeightPercent: gradingItem?.course_weight_percent ?? null,
        position,
        documents: getPublicDocumentLinks(test.documents, position),
      }
    }) : [],
    lessonPlans: visibility.lesson_plans ? lesson_plans.map((lesson, index) => ({
      key: `lesson:${index}`,
      contentMarkdown: String(lesson.content_markdown || ''),
    })) : [],
    announcements: visibility.announcements ? announcements.map((announcement, index) => ({
      key: `announcement:${announcement.id || index}`,
      title: typeof announcement.title === 'string' && announcement.title.trim()
        ? announcement.title.trim()
        : null,
      content: String(announcement.content || ''),
      publishedAt: announcement.scheduled_for || announcement.created_at,
    })) : [],
  }
}
