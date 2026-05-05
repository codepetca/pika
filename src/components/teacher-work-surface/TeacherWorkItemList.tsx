'use client'

import type { ReactNode } from 'react'
import { PageStack } from '@/components/PageLayout'
import { cn } from '@/ui/utils'

interface TeacherWorkItemListProps {
  children: ReactNode
  className?: string
}

export function TeacherWorkItemList({ children, className }: TeacherWorkItemListProps) {
  return (
    <PageStack className={cn('w-full', className)}>
      {children}
    </PageStack>
  )
}
