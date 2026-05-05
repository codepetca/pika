'use client'

import { PageContent, PageLayout } from '@/components/PageLayout'
import { TeacherClassResourcesSidebar } from './TeacherClassResourcesSidebar'
import type { Classroom } from '@/types'

interface Props {
  classroom: Classroom
}

export function TeacherResourcesTab({ classroom }: Props) {
  return (
    <PageLayout>
      <PageContent>
        <TeacherClassResourcesSidebar classroom={classroom} />
      </PageContent>
    </PageLayout>
  )
}
