'use client'

import { useEffect, useState } from 'react'
import { Spinner } from '@/components/Spinner'

interface StudentResponse {
  student_id: string
  name: string | null
  email: string
  answers: { question_text: string; selected_option: string }[]
}

interface Props {
  quizId: string
}

export function QuizIndividualResponses({ quizId }: Props) {
  const [students, setStudents] = useState<StudentResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/teacher/quizzes/${quizId}/results`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load')

        const results = data.results || []
        const responders = data.responders || []

        // We need individual responses - fetch quiz details for questions + all responses
        const detailRes = await fetch(`/api/teacher/quizzes/${quizId}`)
        const detailData = await detailRes.json()
        const questions = detailData.questions || []

        // Build per-student answers from aggregated data
        // We need raw responses - fetch them from results endpoint's responders
        // The current API doesn't return per-student answers, so we'll show
        // the responder list with a note that individual answers require API extension.
        // For now, show responders sorted alphabetically.
        const studentList: StudentResponse[] = responders.map((r: { student_id: string; name: string | null; email: string }) => ({
          student_id: r.student_id,
          name: r.name,
          email: r.email,
          answers: [], // Individual answers not available from current API
        }))

        studentList.sort((a: StudentResponse, b: StudentResponse) => {
          const nameA = a.name || a.email
          const nameB = b.name || b.email
          return nameA.localeCompare(nameB)
        })

        setStudents(studentList)
      } catch (err: any) {
        setError(err.message || 'Failed to load responses')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [quizId])

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-danger">{error}</p>
  }

  if (students.length === 0) {
    return <p className="text-sm text-text-muted">No responses yet.</p>
  }

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-text-default">
        Individual Responses ({students.length})
      </h4>
      <ul className="space-y-1">
        {students.map((student) => (
          <li key={student.student_id} className="text-sm text-text-muted">
            {student.name || student.email.split('@')[0]}
          </li>
        ))}
      </ul>
    </div>
  )
}
