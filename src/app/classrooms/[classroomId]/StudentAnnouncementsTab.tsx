'use client'

import { PageContent, PageLayout } from '@/components/PageLayout'
import { StudentAnnouncementsSection } from './StudentAnnouncementsSection'
import type { Classroom } from '@/types'

interface Props {
  classroom: Classroom
}

export function StudentAnnouncementsTab({ classroom }: Props) {
  return (
    <PageLayout>
      <PageContent>
        <StudentAnnouncementsSection classroom={classroom} className="mx-0 max-w-none" />
      </PageContent>
    </PageLayout>
  )
}
