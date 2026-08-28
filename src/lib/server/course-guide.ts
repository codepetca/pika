import {
  getClassroomActualCourseSite,
  getPublishedActualCourseSite,
  type PublishedActualCourseSiteData,
} from '@/lib/server/course-sites'
import { isEmpty, parseContentField } from '@/lib/tiptap-content'
import { toCourseGuideVisibility, type CourseGuideData } from '@/lib/course-guide'

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
  const { classroom, resources, assignments, tests } = site
  const visibility = toCourseGuideVisibility(classroom.actual_site_config)
  const resourcesContent = resources?.content ? parseContentField(resources.content) : null

  return {
    classroom: {
      title: classroom.title,
    },
    visibility,
    overviewMarkdown: visibility.overview ? classroom.course_overview_markdown : '',
    resourcesContent: visibility.resources && resourcesContent && !isEmpty(resourcesContent)
      ? resourcesContent
      : null,
    assignments: visibility.assignments ? assignments.map((assignment, index) => ({
      key: `assignment:${index}`,
      title: String(assignment.title || 'Untitled assignment'),
    })) : [],
    tests: visibility.tests ? tests.map((test, index) => ({
      key: `test:${index}`,
      title: String(test.title || 'Untitled test'),
    })) : [],
  }
}
