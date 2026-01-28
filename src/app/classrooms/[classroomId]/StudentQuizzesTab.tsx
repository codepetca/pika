'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { Button } from '@/ui'
import { getQuizStatusBadgeClass } from '@/lib/quizzes'
import { StudentQuizForm } from '@/components/StudentQuizForm'
import { StudentQuizResults } from '@/components/StudentQuizResults'
import type { Classroom, StudentQuizView, QuizQuestion } from '@/types'

interface Props {
  classroom: Classroom
}

export function StudentQuizzesTab({ classroom }: Props) {
  const [quizzes, setQuizzes] = useState<StudentQuizView[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null)
  const [selectedQuiz, setSelectedQuiz] = useState<{
    quiz: StudentQuizView
    questions: QuizQuestion[]
    studentResponses: Record<string, number>
  } | null>(null)
  const [loadingQuiz, setLoadingQuiz] = useState(false)

  const loadQuizzes = useCallback(async () => {
    try {
      const res = await fetch(`/api/student/quizzes?classroom_id=${classroom.id}`)
      const data = await res.json()
      setQuizzes(data.quizzes || [])
    } catch (err) {
      console.error('Error loading quizzes:', err)
    } finally {
      setLoading(false)
    }
  }, [classroom.id])

  useEffect(() => {
    loadQuizzes()
  }, [loadQuizzes])

  async function handleSelectQuiz(quizId: string) {
    setSelectedQuizId(quizId)
    setLoadingQuiz(true)

    try {
      const res = await fetch(`/api/student/quizzes/${quizId}`)
      const data = await res.json()
      setSelectedQuiz({
        quiz: data.quiz,
        questions: data.questions || [],
        studentResponses: data.student_responses || {},
      })
    } catch (err) {
      console.error('Error loading quiz:', err)
    } finally {
      setLoadingQuiz(false)
    }
  }

  function handleBack() {
    setSelectedQuizId(null)
    setSelectedQuiz(null)
    loadQuizzes() // Refresh list to get updated status
  }

  function handleQuizSubmitted() {
    // Reload the quiz to get updated status
    if (selectedQuizId) {
      handleSelectQuiz(selectedQuizId)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  // Quiz Detail View
  if (selectedQuizId && selectedQuiz) {
    const hasResponded = Object.keys(selectedQuiz.studentResponses).length > 0

    return (
      <PageLayout>
        <PageContent>
          <div className="max-w-2xl mx-auto">
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-1 text-sm text-text-muted hover:text-text-default mb-4"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to quizzes
            </button>

            <h2 className="text-xl font-bold text-text-default mb-1">{selectedQuiz.quiz.title}</h2>

            {hasResponded && selectedQuiz.quiz.show_results && selectedQuiz.quiz.status === 'closed' ? (
              <StudentQuizResults
                quizId={selectedQuizId}
                myResponses={selectedQuiz.studentResponses}
              />
            ) : hasResponded ? (
              <div className="mt-6 p-4 bg-success-bg rounded-lg text-center">
                <p className="text-success font-medium">You have submitted your response.</p>
                {selectedQuiz.quiz.status !== 'closed' && selectedQuiz.quiz.show_results ? (
                  <p className="text-sm text-text-muted mt-1">
                    Results will be available after the quiz closes.
                  </p>
                ) : selectedQuiz.quiz.status === 'closed' && !selectedQuiz.quiz.show_results ? (
                  <p className="text-sm text-text-muted mt-1">
                    Results are not available for this quiz.
                  </p>
                ) : (
                  <p className="text-sm text-text-muted mt-1">
                    Your response has been recorded.
                  </p>
                )}
              </div>
            ) : (
              <StudentQuizForm
                quizId={selectedQuizId}
                questions={selectedQuiz.questions}
                onSubmitted={handleQuizSubmitted}
              />
            )}
          </div>
        </PageContent>
      </PageLayout>
    )
  }

  // Loading quiz details
  if (selectedQuizId && loadingQuiz) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  // Quiz List View
  return (
    <PageLayout>
      <PageContent>
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-text-default mb-4">Quizzes</h2>

          {quizzes.length === 0 ? (
            <p className="text-text-muted text-center py-8">No quizzes available.</p>
          ) : (
            <div className="space-y-3">
              {quizzes.map((quiz) => (
                <button
                  key={quiz.id}
                  type="button"
                  onClick={() => handleSelectQuiz(quiz.id)}
                  className="w-full text-left p-4 rounded-lg border border-border bg-surface hover:bg-surface-hover transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-text-default">{quiz.title}</h3>
                    {quiz.student_status === 'not_started' && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${getQuizStatusBadgeClass('active')}`}>
                        New
                      </span>
                    )}
                    {quiz.student_status === 'responded' && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-surface-2 text-text-muted">
                        Submitted
                      </span>
                    )}
                    {quiz.student_status === 'can_view_results' && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-info-bg text-info">
                        View Results
                      </span>
                    )}
                  </div>
                  {quiz.status === 'closed' && (
                    <p className="text-xs text-text-muted mt-1">This quiz is closed</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </PageContent>
    </PageLayout>
  )
}
