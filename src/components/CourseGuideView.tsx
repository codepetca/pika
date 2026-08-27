import { ExternalLink, Pencil } from 'lucide-react'
import type { ReactNode } from 'react'
import { AnnouncementContent } from '@/components/AnnouncementContent'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import {
  formatCourseGuideDueDate,
  hasCourseGuideContent,
  type CourseGuideAssignment,
  type CourseGuideData,
  type CourseGuideTest,
} from '@/lib/course-guide'
import { formatAnnouncementTimestamp } from '@/lib/announcements'
import { Button, PageContent, PageHeading, PageLayout, PageState, cn } from '@/ui'

export type CourseGuideEditableSection = 'overview' | 'resources'

type CourseGuideViewProps = {
  guide: CourseGuideData
  embedded?: boolean
  editMode?: boolean
  activeEditor?: CourseGuideEditableSection | null
  onEditSection?: (section: CourseGuideEditableSection) => void
  overviewEditor?: ReactNode
  resourcesEditor?: ReactNode
}

function CourseGuideSection({
  id,
  title,
  children,
  className,
  editAction,
}: {
  id: string
  title: string
  children: ReactNode
  className?: string
  editAction?: {
    label: string
    active: boolean
    onSelect: () => void
  }
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={cn('border-t border-border py-5 sm:py-6', className)}
    >
      <div className="grid gap-3 md:grid-cols-4 md:gap-6">
        <h2 id={`${id}-heading`} className="text-base font-semibold text-text-default md:col-span-1">
          {editAction ? (
            <Button
              type="button"
              variant={editAction.active ? 'secondary' : 'ghost'}
              size="sm"
              aria-label={editAction.label}
              aria-pressed={editAction.active}
              onClick={editAction.onSelect}
              className="-ml-3 h-auto min-h-control justify-start whitespace-normal py-2 text-left"
            >
              <Pencil className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{title}</span>
            </Button>
          ) : title}
        </h2>
        <div className="min-w-0 md:col-span-3">{children}</div>
      </div>
    </section>
  )
}

function AssessmentMeta({ item }: { item: CourseGuideAssignment | CourseGuideTest }) {
  const meta: string[] = []

  if ('dueAt' in item && item.dueAt) {
    meta.push(`Due ${formatCourseGuideDueDate(item.dueAt)}`)
  }
  if (item.pointsPossible != null) {
    meta.push(`${item.pointsPossible} point${item.pointsPossible === 1 ? '' : 's'}`)
  }
  if (!item.includeInFinal) {
    meta.push('Not in final grade')
  } else if (item.courseWeightPercent != null) {
    meta.push(`${item.courseWeightPercent}% of course`)
  }

  if (meta.length === 0) return null

  return (
    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-muted">
      {meta.map((value) => <span key={value}>{value}</span>)}
    </div>
  )
}

function AssessmentList({
  items,
  kind,
}: {
  items: Array<CourseGuideAssignment | CourseGuideTest>
  kind: 'assignment' | 'test'
}) {
  return (
    <div className="divide-y divide-border">
      {items.map((item, index) => (
        <article key={item.key} className="py-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0 text-xs font-semibold uppercase text-text-muted">
              {kind === 'assignment' ? `A${index + 1}` : `T${index + 1}`}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-text-default">{item.title}</h3>
              <AssessmentMeta item={item} />
              {'instructionsMarkdown' in item && item.instructionsMarkdown.trim() ? (
                <LimitedMarkdown content={item.instructionsMarkdown} className="mt-3 text-sm [&_p]:leading-6" />
              ) : null}
              {'documents' in item && item.documents.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.documents.map((document) => (
                    <a
                      key={document.key}
                      href={document.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-control items-center gap-2 rounded-control border border-border px-3 py-2 text-sm font-medium text-primary transition-colors duration-fast hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-foundation focus-visible:ring-focus focus-visible:ring-offset-foundation"
                    >
                      {document.title}
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}

export function CourseGuideView({
  guide,
  embedded = false,
  editMode = false,
  activeEditor = null,
  onEditSection,
  overviewEditor,
  resourcesEditor,
}: CourseGuideViewProps) {
  const hasContent = hasCourseGuideContent(guide)
  const overviewVisible = guide.visibility.overview && (editMode || guide.overviewMarkdown.trim())
  const resourcesVisible = guide.visibility.resources && (editMode || guide.resourcesContent)

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
              title="Curriculum overview and expectations"
              className="border-t-0"
              editAction={editMode && onEditSection ? {
                label: 'Edit curriculum overview and expectations',
                active: activeEditor === 'overview',
                onSelect: () => onEditSection('overview'),
              } : undefined}
            >
              {activeEditor === 'overview' && overviewEditor ? overviewEditor : (
                guide.overviewMarkdown.trim() ? (
                  <LimitedMarkdown content={guide.overviewMarkdown} className="space-y-3 [&_p]:leading-6" />
                ) : (
                  <p className="text-sm text-text-muted">Add curriculum context and classroom expectations.</p>
                )
              )}
            </CourseGuideSection>
          ) : null}

          {resourcesVisible ? (
            <CourseGuideSection
              id="resources"
              title="Resources"
              className={!overviewVisible ? 'border-t-0' : undefined}
              editAction={editMode && onEditSection ? {
                label: 'Edit resources',
                active: activeEditor === 'resources',
                onSelect: () => onEditSection('resources'),
              } : undefined}
            >
              {activeEditor === 'resources' && resourcesEditor ? resourcesEditor : (
                guide.resourcesContent ? (
                  <RichTextViewer content={guide.resourcesContent} chrome="flush" />
                ) : (
                  <p className="text-sm text-text-muted">Add rules, links, and reference material.</p>
                )
              )}
            </CourseGuideSection>
          ) : null}

          {guide.visibility.assignments && guide.assignments.length > 0 ? (
            <CourseGuideSection id="assignments" title="Assignments">
              <AssessmentList items={guide.assignments} kind="assignment" />
            </CourseGuideSection>
          ) : null}

          {guide.visibility.tests && guide.tests.length > 0 ? (
            <CourseGuideSection id="tests" title="Tests">
              <AssessmentList items={guide.tests} kind="test" />
            </CourseGuideSection>
          ) : null}

          {guide.visibility.lesson_plans && guide.lessonPlans.length > 0 ? (
            <CourseGuideSection id="lesson-sequence" title="Lesson sequence">
              <div className="divide-y divide-border">
                {guide.lessonPlans.map((lesson) => (
                  <article key={lesson.key} className="py-3">
                    <LimitedMarkdown content={lesson.contentMarkdown} className="[&_p]:leading-6" />
                  </article>
                ))}
              </div>
            </CourseGuideSection>
          ) : null}

          {guide.visibility.announcements && guide.announcements.length > 0 ? (
            <CourseGuideSection id="announcements" title="Announcements">
              <div className="divide-y divide-border">
                {guide.announcements.map((announcement) => (
                  <article key={announcement.key} className="py-3">
                    <div className="text-xs font-medium text-text-muted">
                      {formatAnnouncementTimestamp(announcement.publishedAt)}
                    </div>
                    {announcement.title ? (
                      <h3 className="mt-1 text-base font-semibold text-text-default">{announcement.title}</h3>
                    ) : null}
                    <AnnouncementContent content={announcement.content} className="mt-2" />
                  </article>
                ))}
              </div>
            </CourseGuideSection>
          ) : null}
        </PageContent>
      </PageLayout>
    </main>
  )
}
