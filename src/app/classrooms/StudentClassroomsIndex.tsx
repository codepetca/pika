'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageActionBar, PageContent, PageLayout, type ActionBarItem } from '@/components/PageLayout'
import type { Classroom } from '@/types'

interface Props {
  initialClassrooms: Classroom[]
}

export function StudentClassroomsIndex({ initialClassrooms }: Props) {
  const router = useRouter()
  const [classrooms] = useState<Classroom[]>(initialClassrooms)

  const sorted = useMemo(() => {
    return [...classrooms].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }, [classrooms])

  return (
    <PageLayout className="max-w-5xl mx-auto">
      <PageActionBar
        primary={
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Classrooms</h1>
        }
        actions={
          [
            {
              id: 'join-classroom',
              label: '+ Join classroom',
              onSelect: () => router.push('/join'),
            },
          ] satisfies ActionBarItem[]
        }
      />

      <PageContent>
        {sorted.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-10 text-center">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">No classrooms yet</h2>
            <div className="mt-6">
              <button
                type="button"
                className="px-4 py-2 rounded-md bg-blue-600 dark:bg-blue-700 text-white text-sm hover:bg-blue-700 dark:hover:bg-blue-600"
                onClick={() => router.push('/join')}
              >
                Join classroom
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
            {sorted.map((c) => (
              <button
                key={c.id}
                data-testid="classroom-card"
                onClick={() => router.push(`/classrooms/${c.id}?tab=today`)}
                className="w-full p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              >
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{c.title}</div>
                <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Code: <span className="font-mono">{c.class_code}</span>
                  {c.term_label ? ` • ${c.term_label}` : ''}
                </div>
              </button>
            ))}
          </div>
        )}
      </PageContent>
    </PageLayout>
  )
}
