import { notFound } from 'next/navigation'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { buildMarkdownSectionContent, getPublishedPlannedCourseSite } from '@/lib/server/course-sites'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function PlannedCourseSitePage({ params }: PageProps) {
  const { slug } = await params
  const result = await getPublishedPlannedCourseSite(slug)

  if (!result.ok) {
    notFound()
  }

  const { blueprint } = result.site
  const config = blueprint.planned_site_config

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="rounded-card border border-border bg-surface p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">Planned Course</p>
        <h1 className="mt-2 text-3xl font-semibold text-text-default">{blueprint.title}</h1>
        <p className="mt-2 text-sm text-text-muted">
          {[blueprint.subject, blueprint.grade_level, blueprint.course_code, blueprint.term_template]
            .filter(Boolean)
            .join(' • ')}
        </p>
      </header>

      <div className="mt-6 space-y-6">
        {config.overview && blueprint.overview_markdown.trim() ? (
          <section className="rounded-card border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold text-text-default">Overview</h2>
            <div className="mt-3">
              <RichTextViewer content={buildMarkdownSectionContent(blueprint.overview_markdown)} chrome="flush" />
            </div>
          </section>
        ) : null}

        {config.outline && blueprint.outline_markdown.trim() ? (
          <section className="rounded-card border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold text-text-default">Outline</h2>
            <div className="mt-3">
              <RichTextViewer content={buildMarkdownSectionContent(blueprint.outline_markdown)} chrome="flush" />
            </div>
          </section>
        ) : null}

        {config.resources && blueprint.resources_markdown.trim() ? (
          <section className="rounded-card border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold text-text-default">Resources</h2>
            <div className="mt-3">
              <RichTextViewer content={buildMarkdownSectionContent(blueprint.resources_markdown)} chrome="flush" />
            </div>
          </section>
        ) : null}

        {config.assignments && blueprint.assignments.length > 0 ? (
          <section className="rounded-card border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold text-text-default">Assignments</h2>
            <div className="mt-4 space-y-4">
              {blueprint.assignments.map((assignment) => (
                <article key={assignment.id} className="rounded-card border border-border bg-surface-2 p-4">
                  <div className="text-base font-semibold text-text-default">{assignment.title}</div>
                  <div className="mt-2">
                    <RichTextViewer content={buildMarkdownSectionContent(assignment.instructions_markdown)} chrome="flush" />
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {(config.quizzes || config.tests) && blueprint.assessments.length > 0 ? (
          <section className="rounded-card border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold text-text-default">Assessments</h2>
            <div className="mt-4 space-y-3">
              {blueprint.assessments
                .filter((assessment) =>
                  assessment.assessment_type === 'quiz' ? config.quizzes : config.tests
                )
                .map((assessment) => {
                  const questions = Array.isArray((assessment.content as any)?.questions)
                    ? (assessment.content as any).questions.length
                    : 0
                  return (
                    <article key={assessment.id} className="rounded-card border border-border bg-surface-2 p-4">
                      <div className="text-sm font-semibold uppercase tracking-wide text-text-muted">
                        {assessment.assessment_type}
                      </div>
                      <div className="mt-1 text-base font-semibold text-text-default">{assessment.title}</div>
                      <div className="mt-1 text-sm text-text-muted">{questions} question{questions === 1 ? '' : 's'}</div>
                    </article>
                  )
                })}
            </div>
          </section>
        ) : null}

        {config.lesson_plans && blueprint.lesson_templates.length > 0 ? (
          <section className="rounded-card border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold text-text-default">Lesson Sequence</h2>
            <div className="mt-4 space-y-4">
              {blueprint.lesson_templates.map((lesson) => (
                <article key={lesson.id} className="rounded-card border border-border bg-surface-2 p-4">
                  <div className="text-base font-semibold text-text-default">{lesson.title || 'Lesson template'}</div>
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
