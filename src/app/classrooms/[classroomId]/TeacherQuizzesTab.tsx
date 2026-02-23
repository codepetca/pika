'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import { Button, ConfirmDialog } from '@/ui'
import { useRightSidebar } from '@/components/layout'
import { TEACHER_QUIZZES_UPDATED_EVENT } from '@/lib/events'
import { QuizModal } from '@/components/QuizModal'
import { QuizCard } from '@/components/QuizCard'
import type { Classroom, QuizAssessmentType, QuizWithStats } from '@/types'

interface Props {
  classroom: Classroom
  onSelectQuiz?: (quiz: QuizWithStats | null) => void
}

export function TeacherQuizzesTab({ classroom, onSelectQuiz }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const activeAssessmentType: QuizAssessmentType =
    searchParams.get('quizType') === 'test' ? 'test' : 'quiz'

  const [quizzes, setQuizzes] = useState<QuizWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [deleteQuiz, setDeleteQuiz] = useState<{ quiz: QuizWithStats; responsesCount: number } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const { setOpen: setRightSidebarOpen } = useRightSidebar()

  const isReadOnly = !!classroom.archived_at

  const loadQuizzes = useCallback(async () => {
    setLoading(true)
    try {
      const query = new URLSearchParams({
        classroom_id: classroom.id,
        assessment_type: activeAssessmentType,
      })
      const res = await fetch(`/api/teacher/quizzes?${query.toString()}`)
      const data = await res.json()
      setQuizzes(data.quizzes || [])
    } catch (err) {
      console.error('Error loading quizzes:', err)
    } finally {
      setLoading(false)
    }
  }, [activeAssessmentType, classroom.id])

  useEffect(() => {
    loadQuizzes()
  }, [loadQuizzes])

  // Listen for quiz updates
  useEffect(() => {
    function handleQuizzesUpdated(event: Event) {
      const detail = (event as CustomEvent<{ classroomId?: string }>).detail
      if (!detail || detail.classroomId !== classroom.id) return
      loadQuizzes()
    }
    window.addEventListener(TEACHER_QUIZZES_UPDATED_EVENT, handleQuizzesUpdated)
    return () => window.removeEventListener(TEACHER_QUIZZES_UPDATED_EVENT, handleQuizzesUpdated)
  }, [classroom.id, loadQuizzes])

  // Notify parent when selected quiz changes
  useEffect(() => {
    const selected = quizzes.find((q) => q.id === selectedQuizId) ?? null
    onSelectQuiz?.(selected)
  }, [selectedQuizId, quizzes, onSelectQuiz])

  function handleCardSelect(quiz: QuizWithStats) {
    const newSelectedId = selectedQuizId === quiz.id ? null : quiz.id
    setSelectedQuizId(newSelectedId)
    if (newSelectedId) {
      setRightSidebarOpen(true)
    }
  }

  function handleAssessmentTypeChange(nextType: QuizAssessmentType) {
    if (nextType === activeAssessmentType) return
    const params = new URLSearchParams(searchParams.toString())
    if (nextType === 'quiz') {
      params.delete('quizType')
    } else {
      params.set('quizType', nextType)
    }
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    setSelectedQuizId(null)
    onSelectQuiz?.(null)
  }

  function handleNewQuiz() {
    setShowModal(true)
  }

  function handleQuizCreated() {
    setShowModal(false)
    window.dispatchEvent(
      new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, { detail: { classroomId: classroom.id } })
    )
  }

  async function handleDeleteConfirm() {
    if (!deleteQuiz) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/teacher/quizzes/${deleteQuiz.quiz.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete quiz')
      }
      if (selectedQuizId === deleteQuiz.quiz.id) {
        setSelectedQuizId(null)
      }
      window.dispatchEvent(
        new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, { detail: { classroomId: classroom.id } })
      )
    } catch (err) {
      console.error('Error deleting quiz:', err)
    } finally {
      setDeleting(false)
      setDeleteQuiz(null)
    }
  }

  async function handleRequestDelete(quiz: QuizWithStats) {
    try {
      const res = await fetch(`/api/teacher/quizzes/${quiz.id}/results`)
      const data = await res.json()
      setDeleteQuiz({ quiz, responsesCount: data.stats?.responded || 0 })
    } catch {
      setDeleteQuiz({ quiz, responsesCount: quiz.stats.responded })
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  // Sort by position order
  const sortedQuizzes = [...quizzes].sort((a, b) => a.position - b.position)
  const isTestsView = activeAssessmentType === 'test'
  const assessmentLabel = isTestsView ? 'test' : 'quiz'
  const assessmentLabelPlural = isTestsView ? 'Tests' : 'Quizzes'

  return (
    <PageLayout>
      <PageActionBar
        primary={
          !isReadOnly ? (
            <Button onClick={handleNewQuiz} variant="primary" className="gap-1.5">
              <Plus className="h-4 w-4" />
              {isTestsView ? 'New Test' : 'New Quiz'}
            </Button>
          ) : undefined
        }
      />

      <PageContent>
        <div className="mb-4 inline-flex rounded-lg border border-border bg-surface p-1">
          <button
            type="button"
            onClick={() => handleAssessmentTypeChange('quiz')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              !isTestsView ? 'bg-primary text-text-inverse' : 'text-text-muted hover:text-text-default'
            }`}
          >
            Quizzes
          </button>
          <button
            type="button"
            onClick={() => handleAssessmentTypeChange('test')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              isTestsView ? 'bg-primary text-text-inverse' : 'text-text-muted hover:text-text-default'
            }`}
          >
            Tests
          </button>
        </div>

        {sortedQuizzes.length === 0 ? (
          <p className="text-text-muted text-center py-8">
            No {assessmentLabelPlural.toLowerCase()} yet. Create one to get started.
          </p>
        ) : (
          <div className="space-y-3">
            {sortedQuizzes.map((quiz) => (
              <QuizCard
                key={quiz.id}
                quiz={quiz}
                isSelected={selectedQuizId === quiz.id}
                isReadOnly={isReadOnly}
                onSelect={() => handleCardSelect(quiz)}
                onDelete={() => handleRequestDelete(quiz)}
                onQuizUpdate={loadQuizzes}
              />
            ))}
          </div>
        )}
      </PageContent>

      <QuizModal
        isOpen={showModal}
        classroomId={classroom.id}
        assessmentType={activeAssessmentType}
        quiz={null}
        onClose={() => setShowModal(false)}
        onSuccess={handleQuizCreated}
      />

      <ConfirmDialog
        isOpen={!!deleteQuiz}
        title={`Delete ${assessmentLabel}?`}
        description={
          deleteQuiz && deleteQuiz.responsesCount > 0
            ? `This ${assessmentLabel} has ${deleteQuiz.responsesCount} response${deleteQuiz.responsesCount === 1 ? '' : 's'}. Deleting it will permanently remove all student responses.`
            : 'This action cannot be undone.'
        }
        confirmLabel={deleting ? 'Deleting...' : 'Delete'}
        cancelLabel="Cancel"
        confirmVariant="danger"
        isConfirmDisabled={deleting}
        isCancelDisabled={deleting}
        onCancel={() => setDeleteQuiz(null)}
        onConfirm={handleDeleteConfirm}
      />
    </PageLayout>
  )
}
