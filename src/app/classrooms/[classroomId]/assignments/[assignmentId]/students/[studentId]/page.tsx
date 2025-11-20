'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Spinner } from '@/components/Spinner'
import {
  formatDueDate,
  getAssignmentStatusLabel,
  getAssignmentStatusBadgeClass
} from '@/lib/assignments'
import type { Assignment, AssignmentDoc, AssignmentStatus } from '@/types'

interface StudentWorkData {
  assignment: Assignment
  classroom: {
    id: string
    title: string
  }
  student: {
    id: string
    email: string
    name: string | null
  }
  doc: AssignmentDoc | null
  status: AssignmentStatus
}

export default function StudentWorkPage() {
  const params = useParams()
  const router = useRouter()

  const classroomId = params.classroomId as string
  const assignmentId = params.assignmentId as string
  const studentId = params.studentId as string

  const [data, setData] = useState<StudentWorkData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadStudentWork()
  }, [assignmentId, studentId])

  async function loadStudentWork() {
    try {
      const response = await fetch(
        `/api/teacher/assignments/${assignmentId}/students/${studentId}`
      )
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to load student work')
      }

      setData(result)
    } catch (err: any) {
      console.error('Error loading student work:', err)
      setError(err.message || 'Failed to load student work')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="bg-white rounded-lg shadow-sm p-8 text-center">
          <p className="text-red-600 mb-4">{error || 'Student work not found'}</p>
          <button
            onClick={() => router.back()}
            className="text-blue-600 hover:text-blue-700"
          >
            Go back
          </button>
        </div>
      </div>
    )
  }

  const { assignment, classroom, student, doc, status } = data

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => router.push(`/classrooms/${classroomId}/assignments/${assignmentId}`)}
          className="text-sm text-blue-600 hover:text-blue-700 mb-2"
        >
          ← Back to {assignment.title}
        </button>
        <h1 className="text-2xl font-bold text-gray-900">
          {student.name || student.email}
        </h1>
        {student.name && (
          <p className="text-gray-600">{student.email}</p>
        )}
      </div>

      {/* Assignment Info */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-medium text-gray-900">{assignment.title}</h2>
            <p className="text-sm text-gray-600 mt-1">
              Due: {formatDueDate(assignment.due_at)}
            </p>
          </div>
          <span className={`px-2 py-1 rounded text-xs font-medium ${getAssignmentStatusBadgeClass(status)}`}>
            {getAssignmentStatusLabel(status)}
          </span>
        </div>
      </div>

      {/* Student Work */}
      <div className="bg-white rounded-lg shadow-sm">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Student Response</span>
          {doc?.submitted_at && (
            <span className="text-xs text-gray-500">
              Submitted: {new Date(doc.submitted_at).toLocaleString('en-CA', {
                timeZone: 'America/Toronto',
                dateStyle: 'medium',
                timeStyle: 'short'
              })}
            </span>
          )}
        </div>

        <div className="p-4">
          {doc && doc.content ? (
            <div className="min-h-[200px]">
              <pre className="whitespace-pre-wrap font-mono text-sm text-gray-800 bg-gray-50 p-4 rounded-lg border border-gray-200">
                {doc.content}
              </pre>
              <div className="mt-2 text-xs text-gray-500">
                {doc.content.length} characters
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              No work submitted yet
            </div>
          )}
        </div>

        {doc?.updated_at && (
          <div className="px-4 pb-4">
            <p className="text-xs text-gray-400">
              Last updated: {new Date(doc.updated_at).toLocaleString('en-CA', {
                timeZone: 'America/Toronto',
                dateStyle: 'medium',
                timeStyle: 'short'
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
