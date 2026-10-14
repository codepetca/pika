'use client'

import { PageContent, PageLayout } from '@/components/PageLayout'
import { TeacherAnnouncementsSection } from './TeacherAnnouncementsSection'
import type { Classroom } from '@/types'

interface Props {
  classroom: Classroom
  isActive?: boolean
}

export function TeacherAnnouncementsTab({ classroom, isActive = true }: Props) {
  return (
    <PageLayout>
      <PageContent>
        <TeacherAnnouncementsSection classroom={classroom} isActive={isActive} className="mx-0 max-w-none" />
      </PageContent>
    </PageLayout>
  )
}
