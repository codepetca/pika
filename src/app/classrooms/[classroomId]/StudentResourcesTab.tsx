'use client'

import { PageContent, PageLayout } from '@/components/PageLayout'
import { EmptyState } from '@/ui'
import type { Classroom } from '@/types'

interface Props {
  classroom: Classroom
}

export function StudentResourcesTab({ classroom }: Props) {
  const siteHref = classroom.actual_site_slug ? `/actual/${classroom.actual_site_slug}` : ''
  const isPublished = !!classroom.actual_site_published && !!classroom.actual_site_slug

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
          <EmptyState
            title="No syllabus yet"
            description="Your teacher has not published the syllabus for this class."
            tone="muted"
          />
        </div>
      </PageContent>
    </PageLayout>
  )
}
