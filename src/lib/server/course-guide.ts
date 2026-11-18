import {
  getPublishedActualCourseSite,
  type PublishedActualCourseSiteData,
} from '@/lib/server/course-sites'
import { isEmpty, parseContentField } from '@/lib/tiptap-content'
import { toCourseGuideVisibility, type CourseGuideData } from '@/lib/course-guide'
import { normalizeActualCourseSiteConfig } from '@/lib/course-site-publishing'
import { isAssignmentVisibleToStudents } from '@/lib/assignments'
import { getServiceRoleClient } from '@/lib/supabase'

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
  const supabase = getServiceRoleClient()
  const { data: classroom, error } = await supabase.from('classrooms')
    .select('id, title, actual_site_config, course_overview_markdown')
    .eq('id', classroomId).single()
  if (error || !classroom) return { ok: false, status: 404, error: 'Classroom not found' }

  const [resources, assignments, tests] = await Promise.all([
    supabase.from('classroom_resources').select('content').eq('classroom_id', classroomId).maybeSingle(),
    supabase.from('assignments').select('title, is_draft, released_at').eq('classroom_id', classroomId).order('position', { ascending: true }),
    supabase.from('tests').select('title, status').eq('classroom_id', classroomId).order('position', { ascending: true }),
  ])
  if (resources.error || assignments.error || tests.error) {
    return { ok: false, status: 500, error: 'Failed to load published classroom content' }
  }
  const visibility = toCourseGuideVisibility(normalizeActualCourseSiteConfig(classroom.actual_site_config))
  const content = resources.data?.content ? parseContentField(resources.data.content) : null
  const visibleAssignments = (assignments.data || []).filter((assignment) => isAssignmentVisibleToStudents({
    is_draft: !!assignment.is_draft,
    released_at: typeof assignment.released_at === 'string' ? assignment.released_at : null,
  }))
  const publishedTests = (tests.data || []).filter((test) => test.status !== 'draft')
  return {
    ok: true,
    guide: {
      classroom: { title: String(classroom.title || '') },
      visibility,
      overviewMarkdown: visibility.overview ? String(classroom.course_overview_markdown || '') : '',
      resourcesContent: visibility.resources && content && !isEmpty(content) ? content : null,
      assignments: visibility.assignments ? visibleAssignments.map((assignment, index) => ({
        key: `assignment:${index}`,
        title: String(assignment.title || 'Untitled assignment'),
      })) : [],
      tests: visibility.tests ? publishedTests.map((test, index) => ({
        key: `test:${index}`,
        title: String(test.title || 'Untitled test'),
      })) : [],
    },
  }
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
