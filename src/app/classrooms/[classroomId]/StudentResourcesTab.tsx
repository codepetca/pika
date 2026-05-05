'use client'

import { PageContent, PageLayout } from '@/components/PageLayout'
import { StudentClassResourcesSidebar } from './StudentClassResourcesSidebar'
import type { Classroom } from '@/types'

interface Props {
  classroom: Classroom
}

export function StudentResourcesTab({ classroom }: Props) {
  return (
    <PageLayout>
      <PageContent>
        <StudentClassResourcesSidebar classroom={classroom} />
      </PageContent>
    </PageLayout>
  )
}
