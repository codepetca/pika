'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
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
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Classrooms</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">Select a classroom to view assignments and submit your daily logs.</p>
        </div>
        <button
          type="button"
          className="px-4 py-2 rounded-md bg-blue-600 dark:bg-blue-700 text-white text-sm hover:bg-blue-700 dark:hover:bg-blue-600"
          onClick={() => router.push('/join')}
        >
          + Join classroom
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-10 text-center">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">No classrooms yet</h2>
          <p className="text-gray-600 dark:text-gray-400 mt-2">Join a classroom using the code from your teacher.</p>
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
            <div key={c.id} className="p-4 flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{c.title}</div>
                <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Code: <span className="font-mono">{c.class_code}</span>
                  {c.term_label ? ` • ${c.term_label}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => router.push(`/classrooms/${c.id}?tab=today`)}
                className="px-3 py-2 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Open
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
