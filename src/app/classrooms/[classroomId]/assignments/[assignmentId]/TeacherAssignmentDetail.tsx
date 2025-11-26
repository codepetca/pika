'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Spinner } from '@/components/Spinner'
import {
  formatDueDate,
  getAssignmentStatusLabel,
  getAssignmentStatusBadgeClass
} from '@/lib/assignments'
import type { Assignment, AssignmentDoc, AssignmentStatus } from '@/types'

interface StudentSubmission {
  student_id: string
  student_email: string
  student_name: string | null
  status: AssignmentStatus
  doc: AssignmentDoc | null
}

interface AssignmentData {
  assignment: Assignment
  classroom: {
    id: string
    title: string
  }
  students: StudentSubmission[]
}

interface Props {
  classroomId: string
  assignmentId: string
}

export function TeacherAssignmentDetail({ classroomId, assignmentId }: Props) {
  const router = useRouter()

  const [data, setData] = useState<AssignmentData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadAssignment()
  }, [assignmentId])

  async function loadAssignment() {
    try {
      const response = await fetch(`/api/teacher/assignments/${assignmentId}`)
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to load assignment')
      }

      setData(result)
    } catch (err: any) {
      console.error('Error loading assignment:', err)
      setError(err.message || 'Failed to load assignment')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-8 text-center">
        <p className="text-red-600 mb-4">{error || 'Assignment not found'}</p>
        <button
          onClick={() => router.back()}
          className="text-blue-600 hover:text-blue-700"
        >
          Go back
        </button>
      </div>
    )
  }

  const { assignment, classroom, students } = data

  // Calculate stats
  const submitted = students.filter(s =>
    s.status === 'submitted_on_time' || s.status === 'submitted_late'
  ).length
  const late = students.filter(s => s.status === 'submitted_late').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => router.push(`/classrooms/${classroomId}`)}
          className="text-sm text-blue-600 hover:text-blue-700 mb-2"
        >
          ← Back to {classroom.title}
        </button>
        <h1 className="text-2xl font-bold text-gray-900">{assignment.title}</h1>
        <p className="text-gray-600 mt-1">
          Due: {formatDueDate(assignment.due_at)}
        </p>
      </div>

      {/* Description */}
      {assignment.description && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <p className="text-gray-700 whitespace-pre-wrap">{assignment.description}</p>
        </div>
      )}

      {/* Stats Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">{students.length}</div>
          <div className="text-sm text-gray-600">Students</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 text-center">
          <div className="text-2xl font-bold text-green-600">{submitted}</div>
          <div className="text-sm text-gray-600">Submitted</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 text-center">
          <div className="text-2xl font-bold text-orange-600">{late}</div>
          <div className="text-sm text-gray-600">Late</div>
        </div>
      </div>

      {/* Student List */}
      <div className="bg-white rounded-lg shadow-sm">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Student Submissions</h2>
        </div>

        <div className="divide-y divide-gray-200">
          {students.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No students enrolled
            </div>
          ) : (
            students.map((student) => (
              <Link
                key={student.student_id}
                href={`/classrooms/${classroomId}/assignments/${assignmentId}/students/${student.student_id}`}
                className="block p-4 hover:bg-gray-50 transition"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-900">
                      {student.student_name || student.student_email}
                    </div>
                    {student.student_name && (
                      <div className="text-sm text-gray-500">
                        {student.student_email}
                      </div>
                    )}
                    {student.doc?.updated_at && (
                      <div className="text-xs text-gray-400 mt-1">
                        Last updated: {new Date(student.doc.updated_at).toLocaleString('en-CA', {
                          timeZone: 'America/Toronto',
                          dateStyle: 'short',
                          timeStyle: 'short'
                        })}
                      </div>
                    )}
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${getAssignmentStatusBadgeClass(student.status)}`}>
                    {getAssignmentStatusLabel(student.status)}
                  </span>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
