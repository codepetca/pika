import { Pencil } from 'lucide-react'
import type { ReactNode } from 'react'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import {
  hasCourseGuideContent,
  type CourseGuideAssignment,
  type CourseGuideData,
  type CourseGuideTest,
} from '@/lib/course-guide'
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
