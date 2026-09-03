import type { ReactNode } from 'react'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import {
  hasCourseGuideContent,
  type CourseGuideAssignment,
  type CourseGuideData,
  type CourseGuideTest,
} from '@/lib/course-guide'
import { PageContent, PageHeading, PageLayout, PageState, cn } from '@/ui'

type CourseGuideViewProps = {
  guide: CourseGuideData
  embedded?: boolean
  editMode?: boolean
  overviewEditor?: ReactNode
}

function CourseGuideSection({
  id,
  title,
  children,
  className,
}: {
  id: string
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={cn('border-t border-border py-5 sm:py-6', className)}
    >
      <div className="grid gap-3 md:grid-cols-4 md:gap-6">
        <h2 id={`${id}-heading`} className="text-base font-semibold text-text-default md:col-span-1">
          {title}
        </h2>
        <div className="min-w-0 md:col-span-3">{children}</div>
      </div>
    </section>
  )
}

function AssessmentList({
  items,
}: {
  items: Array<CourseGuideAssignment | CourseGuideTest>
}) {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.key} className="py-1.5 text-sm font-medium text-text-default">
          {item.title}
        </li>
      ))}
    </ul>
  )
}

export function CourseGuideView({
  guide,
  embedded = false,
  editMode = false,
  overviewEditor,
}: CourseGuideViewProps) {
  const hasContent = hasCourseGuideContent(guide)
  const overviewVisible = editMode || (guide.visibility.overview && guide.overviewMarkdown.trim())

  return (
    <main className={cn('min-h-full bg-page', !embedded && 'min-h-screen')}>
      <div className="border-b border-border bg-surface">
        <PageLayout width="wide" density="student" bleedX={false}>
          <PageContent className="py-2">
            {!embedded ? (
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Course Guide
              </p>
            ) : null}
            <PageHeading
              title={guide.classroom.title}
            />
          </PageContent>
        </PageLayout>
      </div>

      <PageLayout width="wide" density="student" bleedX={false}>
        <PageContent className="pb-10 pt-0">
          {!hasContent && !editMode ? (
            <PageState
              kind="empty"
              title="Course guide details are being prepared."
              description="Check back as course information is published."
            />
          ) : null}

          {overviewVisible ? (
            <CourseGuideSection
              id="overview"
              title="Course guide"
              className="border-t-0"
            >
              {editMode && overviewEditor ? overviewEditor : (
                guide.overviewMarkdown.trim() ? (
                  <LimitedMarkdown content={guide.overviewMarkdown} className="space-y-3 [&_p]:leading-6" />
                ) : (
                  <p className="text-sm text-text-muted">Add your course guide.</p>
                )
              )}
            </CourseGuideSection>
          ) : null}

          {guide.visibility.assignments && guide.assignments.length > 0 ? (
            <CourseGuideSection id="assignments" title="Assignments">
              <AssessmentList items={guide.assignments} />
            </CourseGuideSection>
          ) : null}

          {guide.visibility.tests && guide.tests.length > 0 ? (
            <CourseGuideSection id="tests" title="Tests">
              <AssessmentList items={guide.tests} />
            </CourseGuideSection>
          ) : null}
        </PageContent>
      </PageLayout>
    </main>
  )
}
