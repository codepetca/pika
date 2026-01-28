'use client'

import { useEffect, useState } from 'react'
import { Spinner } from '@/components/Spinner'

interface QuestionInfo {
  id: string
  question_text: string
  options: string[]
}

interface Responder {
  student_id: string
  name: string | null
  email: string
  answers: Record<string, number>
}

interface Props {
  quizId: string
}

export function QuizIndividualResponses({ quizId }: Props) {
  const [responders, setResponders] = useState<Responder[]>([])
  const [questions, setQuestions] = useState<QuestionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/teacher/quizzes/${quizId}/results`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load')

        setResponders(data.responders || [])
        setQuestions(data.questions || [])
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

  if (responders.length === 0) {
    return <p className="text-sm text-text-muted">No responses yet.</p>
  }

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-text-default">
        Individual Responses ({responders.length})
      </h4>
      <ul className="space-y-1">
        {responders.map((student) => (
          <li key={student.student_id}>
            <button
              type="button"
              onClick={() =>
                setExpandedStudent(
                  expandedStudent === student.student_id ? null : student.student_id
                )
              }
              className="w-full text-left text-sm text-text-muted hover:text-text-default transition-colors"
            >
              {student.name || student.email.split('@')[0]}
              <span className="ml-1 text-xs">
                {expandedStudent === student.student_id ? '▾' : '▸'}
              </span>
            </button>
            {expandedStudent === student.student_id && (
              <ul className="ml-4 mt-1 space-y-0.5">
                {questions.map((q, idx) => {
                  const selectedIdx = student.answers[q.id]
                  const selectedText =
                    selectedIdx !== undefined ? q.options[selectedIdx] : '—'
                  return (
                    <li key={q.id} className="text-xs text-text-muted">
                      Q{idx + 1}: {selectedText}
                    </li>
                  )
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
