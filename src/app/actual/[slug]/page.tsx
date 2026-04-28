import { notFound } from 'next/navigation'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { buildMarkdownSectionContent, getPublishedActualCourseSite } from '@/lib/server/course-sites'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function ActualCourseSitePage({ params }: PageProps) {
  const { slug } = await params
  const result = await getPublishedActualCourseSite(slug)

  if (!result.ok) {
    notFound()
  }

  const { classroom, resources, assignments, quizzes, tests, lesson_plans, announcements } = result.site
  const config = classroom.actual_site_config

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="rounded-card border border-border bg-surface p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">Actual Course</p>
        <h1 className="mt-2 text-3xl font-semibold text-text-default">{classroom.title}</h1>
        <p className="mt-2 text-sm text-text-muted">
          {[classroom.term_label, classroom.class_code].filter(Boolean).join(' • ')}
        </p>
      </header>

      <div className="mt-6 space-y-6">
        {config.overview && classroom.course_overview_markdown.trim() ? (
          <section className="rounded-card border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold text-text-default">Overview</h2>
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

        {config.announcements && announcements.length > 0 ? (
          <section className="rounded-card border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold text-text-default">Announcements</h2>
            <div className="mt-4 space-y-3">
              {announcements.map((announcement) => (
                <article key={announcement.id} className="rounded-card border border-border bg-surface-2 p-4">
                  <div className="text-xs text-text-muted">
                    {new Date(announcement.created_at).toLocaleDateString('en-CA')}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-text-default">{announcement.content}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {config.resources && resources?.content ? (
          <section className="rounded-card border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold text-text-default">Resources</h2>
            <div className="mt-3">
              <RichTextViewer content={resources.content} chrome="flush" />
            </div>
          </section>
        ) : null}

        {config.assignments && assignments.length > 0 ? (
          <section className="rounded-card border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold text-text-default">Assignments</h2>
            <div className="mt-4 space-y-4">
              {assignments.map((assignment) => (
                <article key={`${assignment.position}:${assignment.title}`} className="rounded-card border border-border bg-surface-2 p-4">
                  <div className="text-base font-semibold text-text-default">{assignment.title}</div>
                  <div className="mt-2">
                    <RichTextViewer content={buildMarkdownSectionContent(assignment.instructions_markdown)} chrome="flush" />
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {(config.quizzes || config.tests) && (quizzes.length > 0 || tests.length > 0) ? (
          <section className="rounded-card border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold text-text-default">Assessments</h2>
            <div className="mt-4 space-y-3">
              {config.quizzes
                ? quizzes.map((quiz) => {
                    const questions = Array.isArray((quiz.content as any)?.questions)
                      ? (quiz.content as any).questions.length
                      : 0
                    return (
                      <article key={`${quiz.position}:${quiz.title}`} className="rounded-card border border-border bg-surface-2 p-4">
                        <div className="text-sm font-semibold uppercase tracking-wide text-text-muted">quiz</div>
                        <div className="mt-1 text-base font-semibold text-text-default">{quiz.title}</div>
                        <div className="mt-1 text-sm text-text-muted">{questions} question{questions === 1 ? '' : 's'}</div>
                      </article>
                    )
                  })
                : null}
              {config.tests
                ? tests.map((test) => {
                    const questions = Array.isArray((test.content as any)?.questions)
                      ? (test.content as any).questions.length
                      : 0
                    return (
                      <article key={`${test.position}:${test.title}`} className="rounded-card border border-border bg-surface-2 p-4">
                        <div className="text-sm font-semibold uppercase tracking-wide text-text-muted">test</div>
                        <div className="mt-1 text-base font-semibold text-text-default">{test.title}</div>
                        <div className="mt-1 text-sm text-text-muted">{questions} question{questions === 1 ? '' : 's'}</div>
                      </article>
                    )
                  })
                : null}
            </div>
          </section>
        ) : null}

        {config.lesson_plans && lesson_plans.length > 0 ? (
          <section className="rounded-card border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold text-text-default">Current Lesson Sequence</h2>
            <div className="mt-4 space-y-4">
              {lesson_plans.map((lesson) => (
                <article key={`${lesson.position}:${lesson.title}`} className="rounded-card border border-border bg-surface-2 p-4">
                  <div className="text-base font-semibold text-text-default">{lesson.title}</div>
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
