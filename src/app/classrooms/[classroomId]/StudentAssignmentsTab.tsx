'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Spinner } from '@/components/Spinner'
import { PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import {
  formatDueDate,
  formatRelativeDueDate,
  getAssignmentStatusLabel,
  getAssignmentStatusBadgeClass,
} from '@/lib/assignments'
import type { AssignmentWithStatus, Classroom } from '@/types'

interface Props {
  classroom: Classroom
}

export function StudentAssignmentsTab({ classroom }: Props) {
  const [assignments, setAssignments] = useState<AssignmentWithStatus[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/student/assignments?classroom_id=${classroom.id}`)
        const data = await res.json()
        setAssignments(data.assignments || [])
      } catch (err) {
        console.error('Error loading assignments:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [classroom.id])

  return (
    <PageLayout>
      <PageActionBar
        primary={<div className="text-sm font-medium text-gray-900 dark:text-gray-100">Assignments</div>}
      />
      <PageContent>
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm">
          <div className="p-4">
            {loading ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : assignments.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">No assignments yet</div>
            ) : (
              <div className="space-y-3">
                {assignments.map((assignment) => (
                  <Link
                    key={assignment.id}
                    href={`/classrooms/${classroom.id}/assignments/${assignment.id}`}
                    className="block p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-medium text-gray-900 dark:text-white truncate">
                          {assignment.title}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          {formatDueDate(assignment.due_at)}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {formatRelativeDueDate(assignment.due_at)}
                        </p>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getAssignmentStatusBadgeClass(assignment.status)}`}>
                        {getAssignmentStatusLabel(assignment.status)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </PageContent>
    </PageLayout>
  )
}
