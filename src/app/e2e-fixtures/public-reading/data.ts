import type { PlannedCourseDocumentData } from '@/app/planned/PlannedCourseDocument'
import type { CourseGuideData } from '@/lib/course-guide'

export const longTitle = 'Environmental science and community inquiry through evidence, reflection and practical investigation — distinctive autumn course identity'
export const finalLesson = 'FINAL LESSON SENTINEL: reflect on evidence and communicate your next investigation.'
export const finalTest = 'FINAL TEST SENTINEL: Community inquiry reflection'
const token = 'environmental-science-community-inquiry-reference-'.repeat(8)
export const narrative = Array.from({ length: 10 }, (_, index) =>
  `## Investigation ${index + 1}\n\nStudents collect evidence, discuss competing interpretations, and develop an explanation grounded in careful observations. We revisit these ideas through practical community inquiry and reflective reading.`,
).join('\n\n') + `\n\nReference [https://example.invalid/${token}](https://example.invalid/${token}) and inline \`measurement_${token}\`.\n\n\`\`\`text\n${'preserved_code_measurement_'.repeat(25)}\n\`\`\``

export function plannedFixture(variant: string): PlannedCourseDocumentData {
  const long = variant === 'planned-long'
  const finalOnly = variant === 'planned-final'
  return {
    title: long ? longTitle : 'Planned sparse reading fixture', subject: 'Environmental Science',
    grade_level: 'Grade 11', course_code: 'SVN3M', term_template: 'Autumn inquiry term',
    planned_site_config: { overview: true, outline: true, resources: true, assignments: true, tests: true, lesson_plans: true },
    overview_markdown: long ? narrative : '', outline_markdown: long ? narrative : '',
    resources_markdown: long ? narrative : '',
    assignments: long ? [{ title: longTitle, instructions_markdown: narrative }] : [],
    assessments: long ? [{ title: longTitle, assessment_type: 'test' }] : [],
    lesson_templates: long || finalOnly ? [{ title: 'Final inquiry lesson', content_markdown: `${long ? narrative + '\n\n' : ''}${finalLesson}` }] : [],
  }
}

export function actualFixture(variant: string): CourseGuideData {
  const long = variant === 'actual-long'
  const testsOnly = variant === 'actual-tests'
  return {
    classroom: { title: long ? longTitle : 'Actual sparse reading fixture' },
    visibility: { overview: true, resources: true, assignments: true, tests: true },
    overviewMarkdown: long ? narrative : '',
    resourcesContent: variant === 'actual-resources' ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Legacy resource intentionally absent' }] }] } : null,
    assignments: long ? Array.from({ length: 12 }, (_, index) => ({ key: `assignment:${index}`, title: `${index + 1}. ${longTitle}` })) : [],
    tests: long ? [...Array.from({ length: 12 }, (_, index) => ({ key: `test:${index}`, title: `${index + 1}. ${longTitle}` })), { key: 'test:final', title: finalTest }] : testsOnly ? [{ key: 'test:final', title: finalTest }] : [],
  }
}

export const publicReadingVariants = ['planned-long', 'planned-final', 'planned-empty', 'actual-long', 'actual-tests', 'actual-empty', 'actual-resources'] as const
