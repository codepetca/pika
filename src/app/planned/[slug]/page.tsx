import { notFound } from 'next/navigation'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { buildMarkdownSectionContent, getPublishedPlannedCourseSite } from '@/lib/server/course-sites'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  params: Promise<{ slug: string }>
}

const sectionClassName = 'scroll-mt-6 py-8 sm:grid sm:grid-cols-[10rem,minmax(0,1fr)] sm:gap-8 sm:py-10'
const itemClassName = 'rounded-md border border-border bg-surface-2 px-4 py-4 sm:px-5'

export default async function PlannedCourseSitePage({ params }: PageProps) {
  const { slug } = await params
  const result = await getPublishedPlannedCourseSite(slug)

  if (!result.ok) {
    notFound()
  }

  const { blueprint } = result.site
  const config = blueprint.planned_site_config
  const visible = {
    overview: config.overview && Boolean(blueprint.overview_markdown.trim()),
    outline: config.outline && Boolean(blueprint.outline_markdown.trim()),
    resources: config.resources && Boolean(blueprint.resources_markdown.trim()),
    assignments: config.assignments && blueprint.assignments.length > 0,
    tests: config.tests && blueprint.assessments.some(
      (assessment) => assessment.assessment_type === 'test',
    ),
    lessons: config.lesson_plans && blueprint.lesson_templates.length > 0,
  }
  const sectionLinks = [
    visible.overview ? ['overview', 'Overview'] : null,
    visible.outline ? ['outline', 'Outline'] : null,
    visible.resources ? ['resources', 'Resources'] : null,
    visible.assignments ? ['assignments', 'Assignments'] : null,
    visible.tests ? ['tests', 'Tests'] : null,
    visible.lessons ? ['lesson-sequence', 'Lesson sequence'] : null,
  ].filter((entry): entry is [string, string] => entry !== null)

  return (
    <main className="min-h-screen bg-page">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">Planned Course</p>
          <h1 className="mt-2 text-3xl font-semibold text-text-default">{blueprint.title}</h1>
          <p className="mt-2 text-sm text-text-muted">
            {[blueprint.subject, blueprint.grade_level, blueprint.course_code, blueprint.term_template]
              .filter(Boolean)
              .join(' • ')}
          </p>

          {sectionLinks.length > 0 ? (
            <nav aria-label="Course sections" className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
              {sectionLinks.map(([id, label]) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className="rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  {label}
                </a>
              ))}
            </nav>
          ) : null}
        </div>
      </header>

      <div className="mx-auto max-w-5xl divide-y divide-border px-4 sm:px-6">
        {visible.overview ? (
          <section id="overview" className={sectionClassName}>
            <h2 className="text-lg font-semibold text-text-default">Overview</h2>
            <div className="mt-3 min-w-0 sm:mt-0">
              <RichTextViewer content={buildMarkdownSectionContent(blueprint.overview_markdown)} chrome="flush" />
            </div>
          </section>
        ) : null}

        {visible.outline ? (
          <section id="outline" className={sectionClassName}>
            <h2 className="text-lg font-semibold text-text-default">Outline</h2>
            <div className="mt-3 min-w-0 sm:mt-0">
              <RichTextViewer content={buildMarkdownSectionContent(blueprint.outline_markdown)} chrome="flush" />
            </div>
          </section>
        ) : null}

        {visible.resources ? (
          <section id="resources" className={sectionClassName}>
            <h2 className="text-lg font-semibold text-text-default">Resources</h2>
            <div className="mt-3 min-w-0 sm:mt-0">
              <RichTextViewer content={buildMarkdownSectionContent(blueprint.resources_markdown)} chrome="flush" />
            </div>
          </section>
        ) : null}

        {visible.assignments ? (
          <section id="assignments" className={sectionClassName}>
            <h2 className="text-lg font-semibold text-text-default">Assignments</h2>
            <div className="mt-4 min-w-0 space-y-3 sm:mt-0">
              {blueprint.assignments.map((assignment, index) => (
                <article key={`assignment-${index}`} className={itemClassName}>
                  <h3 className="text-base font-semibold text-text-default">{assignment.title}</h3>
                  <div className="mt-2">
                    <RichTextViewer content={buildMarkdownSectionContent(assignment.instructions_markdown)} chrome="flush" />
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {visible.tests ? (
          <section id="tests" className={sectionClassName}>
            <h2 className="text-lg font-semibold text-text-default">Tests</h2>
            <div className="mt-4 min-w-0 space-y-3 sm:mt-0">
              {blueprint.assessments
                .filter((assessment) => assessment.assessment_type === 'test')
                .map((assessment, index) => {
                  return (
                    <article key={`test-${index}`} className={itemClassName}>
                      <h3 className="text-base font-semibold text-text-default">{assessment.title}</h3>
                    </article>
                  )
                })}
            </div>
          </section>
        ) : null}

        {visible.lessons ? (
          <section id="lesson-sequence" className={sectionClassName}>
            <h2 className="text-lg font-semibold text-text-default">Lesson Sequence</h2>
            <div className="mt-4 min-w-0 space-y-3 sm:mt-0">
              {blueprint.lesson_templates.map((lesson, index) => (
                <article key={`lesson-${index}`} className={itemClassName}>
                  <h3 className="text-base font-semibold text-text-default">
                    {lesson.title || 'Lesson template'}
                  </h3>
                  <div className="mt-2">
                    <RichTextViewer content={buildMarkdownSectionContent(lesson.content_markdown)} chrome="flush" />
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}
