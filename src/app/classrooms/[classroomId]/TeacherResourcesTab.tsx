'use client'

import { Settings } from 'lucide-react'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { Button, EmptyState } from '@/ui'
import type { Classroom } from '@/types'

interface Props {
  classroom: Classroom
}

export function TeacherResourcesTab({ classroom }: Props) {
  const siteHref = classroom.actual_site_slug ? `/actual/${classroom.actual_site_slug}` : ''
  const isPublished = !!classroom.actual_site_published && !!classroom.actual_site_slug
  const hasBlueprint = !!classroom.source_blueprint_id

  if (isPublished) {
    return (
      <PageLayout className="h-full min-h-0 flex-1">
        <PageContent className="flex min-h-0 flex-1 flex-col px-0 pt-0">
          <iframe
            title={`${classroom.title} syllabus preview`}
            src={siteHref}
            className="h-full min-h-[calc(100vh-3rem)] w-full flex-1 bg-page lg:min-h-0"
          />
        </PageContent>
      </PageLayout>
    )
  }

  return (
    <PageLayout>
      <PageContent>
        <div className="rounded-card border border-border bg-surface-panel p-6 shadow-panel">
          <div>
            <p className="text-sm font-medium text-text-muted">Public syllabus</p>
            <h2 className="mt-1 text-2xl font-semibold text-text-default">Course syllabus</h2>
            <p className="mt-2 max-w-2xl text-sm text-text-muted">
              {hasBlueprint
                ? 'The syllabus uses this classroom course overview, outline, classwork, assessments, and grading details.'
                : 'Link a course blueprint, then publish the syllabus to show it here.'}
            </p>
          </div>

          <div className="mt-5 rounded-card border border-border bg-surface-2 p-4">
            <EmptyState
              title="No published syllabus"
              description={hasBlueprint
                ? "Publish this classroom's syllabus to show it here and let students open it."
                : 'Create this classroom from a blueprint or link a blueprint before publishing a public syllabus.'}
              tone="muted"
            />
          </div>

          <div className="mt-5 flex justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                window.location.href = `/classrooms/${classroom.id}?tab=settings`
              }}
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
              Syllabus Settings
            </Button>
          </div>
        </div>
      </PageContent>
    </PageLayout>
  )
}
