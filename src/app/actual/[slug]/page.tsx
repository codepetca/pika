import { notFound } from 'next/navigation'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { buildMarkdownSectionContent, getPublishedActualCourseSite } from '@/lib/server/course-sites'
import type { PublishedCourseSiteGradingItem } from '@/lib/server/course-sites'
import type { TestDocument } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  params: Promise<{ slug: string }>
}

function formatPercent(value: number | null | undefined) {
  if (value == null) return null
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`
}

function getGradingItemMeta(gradingItems: PublishedCourseSiteGradingItem[], category: PublishedCourseSiteGradingItem['category'], title: string) {
  return gradingItems.find((item) => item.category === category && item.title === title) || null
}

function WeightMeta({ item }: { item: PublishedCourseSiteGradingItem | null }) {
  if (!item) return null

  if (!item.include_in_final) {
    return <span>Not in final grade</span>
  }

  const weight = formatPercent(item.course_weight_percent)
  if (!weight) return null
  return <span>{weight}</span>
}

type SyllabusCourseItem = {
  key: string
  code: string
  title: string
  weight: PublishedCourseSiteGradingItem | null
  unitLabel: string | null
  weekLabel: string | null
  sortPosition: number
}

type SyllabusCourseItemGroup = {
  title: string | null
  items: SyllabusCourseItem[]
}

type TestDocumentLink = {
  key: string
  title: string
  href: string
  testTitle: string
}

function extractUnitLabel(...values: Array<string | null | undefined>) {
  const text = values.filter(Boolean).join('\n')
  const match = text.match(/\b(?:unit|u)\s*([0-9]+)\b/i)
  return match ? `Unit ${match[1]}` : null
}

function extractWeekLabel(...values: Array<string | null | undefined>) {
  const text = values.filter(Boolean).join('\n')
  const match = text.match(/\b(?:week|wk)\s*([0-9]+(?:\s*[-–]\s*[0-9]+)?)\b/i)
  if (!match) return null
  return `Wk ${match[1].replace(/\s+/g, '')}`
}

function getDocumentHref(document: TestDocument) {
  if (document.source === 'link' && document.url?.trim()) return document.url.trim()
  return null
}

function buildTestDocumentLinks(tests: Array<Record<string, any>>): TestDocumentLink[] {
  return tests.flatMap((test, testIndex) => {
    const documents = Array.isArray(test.documents) ? test.documents as TestDocument[] : []
    return documents
      .map((document, documentIndex) => {
        const href = getDocumentHref(document)
        if (!href) return null
        return {
          key: `${test.position ?? testIndex}:${document.id || documentIndex}`,
          title: document.title || `Document ${documentIndex + 1}`,
          href,
          testTitle: String(test.title || 'Test'),
        }
      })
      .filter((item): item is TestDocumentLink => !!item)
  })
}

function groupCourseItems(items: SyllabusCourseItem[]): SyllabusCourseItemGroup[] {
  const hasUnitLabels = items.some((item) => !!item.unitLabel)
  if (!hasUnitLabels) return [{ title: null, items }]

  const groups: SyllabusCourseItemGroup[] = []
  const groupMap = new Map<string, SyllabusCourseItemGroup>()

  items.forEach((item) => {
    const title = item.unitLabel || 'Other'
    let group = groupMap.get(title)
    if (!group) {
      group = { title, items: [] }
      groupMap.set(title, group)
      groups.push(group)
    }
    group.items.push(item)
  })

  return groups
}

export default async function ActualCourseSitePage({ params }: PageProps) {
  const { slug } = await params
  const result = await getPublishedActualCourseSite(slug)

  if (!result.ok) {
    notFound()
  }

  const { classroom, assignments, quizzes, tests, grading } = result.site
  const config = classroom.actual_site_config
  const courseItems: SyllabusCourseItem[] = [
    ...(config.assignments
      ? assignments.map((assignment, index) => ({
          key: `assignment:${assignment.position ?? index}:${assignment.title}`,
          code: `A${index + 1}`,
          title: String(assignment.title || 'Untitled assignment'),
          weight: getGradingItemMeta(grading?.items || [], 'assignments', assignment.title),
          unitLabel: extractUnitLabel(assignment.title, assignment.instructions_markdown),
          weekLabel: extractWeekLabel(assignment.title, assignment.instructions_markdown),
          sortPosition: Number(assignment.position ?? index),
        }))
      : []),
    ...(config.quizzes
      ? quizzes.map((quiz, index) => ({
          key: `quiz:${quiz.position ?? index}:${quiz.title}`,
          code: `Q${index + 1}`,
          title: String(quiz.title || 'Untitled quiz'),
          weight: getGradingItemMeta(grading?.items || [], 'quizzes', quiz.title),
          unitLabel: extractUnitLabel(quiz.title),
          weekLabel: extractWeekLabel(quiz.title),
          sortPosition: Number(quiz.position ?? index) + 0.25,
        }))
      : []),
    ...(config.tests
      ? tests.map((test, index) => ({
          key: `test:${test.position ?? index}:${test.title}`,
          code: `T${index + 1}`,
          title: String(test.title || 'Untitled test'),
          weight: getGradingItemMeta(grading?.items || [], 'tests', test.title),
          unitLabel: extractUnitLabel(test.title),
          weekLabel: extractWeekLabel(test.title),
          sortPosition: Number(test.position ?? index) + 0.5,
        }))
      : []),
  ].sort((left, right) => left.sortPosition - right.sortPosition)
  const courseItemGroups = groupCourseItems(courseItems)
  const testDocumentLinks = buildTestDocumentLinks(config.tests ? tests : [])

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="rounded-card border border-border bg-surface p-6">
        <p className="text-xs font-semibold uppercase text-text-muted">Course Syllabus</p>
        <h1 className="mt-2 text-3xl font-semibold text-text-default">{classroom.title}</h1>
        <p className="mt-2 text-sm text-text-muted">
          {[classroom.term_label, classroom.class_code].filter(Boolean).join(' • ')}
        </p>
      </header>

      <div className="mt-6 space-y-6">
        {config.overview && classroom.course_overview_markdown.trim() ? (
          <section className="rounded-card border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold text-text-default">Course Overview</h2>
            <div className="mt-3">
              <RichTextViewer content={buildMarkdownSectionContent(classroom.course_overview_markdown)} chrome="flush" />
            </div>
          </section>
        ) : null}

        {config.outline && classroom.course_outline_markdown.trim() ? (
          <section className="rounded-card border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold text-text-default">Outline</h2>
            <div className="mt-3">
              <RichTextViewer content={buildMarkdownSectionContent(classroom.course_outline_markdown)} chrome="flush" />
            </div>
          </section>
        ) : null}

        {testDocumentLinks.length > 0 ? (
          <section className="rounded-card border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold text-text-default">Test Docs</h2>
            <div className="mt-4 space-y-3">
              {testDocumentLinks.map((document) => (
                <a
                  key={document.key}
                  href={document.href}
                  className="flex items-center justify-between gap-4 rounded-card border border-border bg-surface-2 px-4 py-3 text-sm transition-colors hover:bg-surface-hover"
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="font-medium text-text-default">{document.title}</span>
                  <span className="shrink-0 text-text-muted">{document.testTitle}</span>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        {courseItems.length > 0 ? (
          <section className="rounded-card border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold text-text-default">Assignments</h2>
            <div className="mt-4 space-y-5">
              {courseItemGroups.map((group) => (
                <div key={group.title || 'assignments'} className="space-y-2">
                  {group.title ? (
                    <h3 className="text-sm font-semibold uppercase text-text-muted">{group.title}</h3>
                  ) : null}
                  <div className="space-y-2">
                    {group.items.map((item) => (
                      <article key={item.key} className="rounded-card border border-border bg-surface-2 px-4 py-3">
                        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
                          <div className="text-xs font-semibold text-text-muted">{item.code}</div>
                          <div className="min-w-0 truncate text-base font-semibold text-text-default">{item.title}</div>
                          <div className="flex shrink-0 items-center gap-3 text-sm font-medium text-text-muted">
                            {item.weekLabel ? <span>{item.weekLabel}</span> : null}
                            <WeightMeta item={item.weight} />
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}
