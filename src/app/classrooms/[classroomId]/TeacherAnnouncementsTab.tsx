'use client'

import { PageContent, PageLayout } from '@/components/PageLayout'
import { TeacherAnnouncementsSection } from './TeacherAnnouncementsSection'
import type { Classroom } from '@/types'

interface Props {
  classroom: Classroom
}

export function TeacherAnnouncementsTab({ classroom }: Props) {
  return (
    <PageLayout>
      <PageContent>
        <TeacherAnnouncementsSection classroom={classroom} className="mx-0 max-w-none" />
      </PageContent>
    </PageLayout>
  )
}
