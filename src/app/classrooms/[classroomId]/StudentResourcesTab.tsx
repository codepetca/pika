'use client'

import { PageContent, PageLayout } from '@/components/PageLayout'
import { RightSidebarToggle } from '@/components/layout'
import { StudentAnnouncementsSection } from './StudentAnnouncementsSection'
import type { Classroom } from '@/types'

interface Props {
  classroom: Classroom
}

export function StudentResourcesTab({ classroom }: Props) {
  return (
    <PageLayout>
      <PageContent>
        <div className="mb-3 flex justify-end lg:hidden">
          <RightSidebarToggle />
        </div>
        <StudentAnnouncementsSection classroom={classroom} className="mx-0 max-w-none" />
      </PageContent>
    </PageLayout>
  )
}
