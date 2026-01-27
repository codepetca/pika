'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import { Button, ConfirmDialog } from '@/ui'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyStateRow,
  KeyboardNavigableTable,
  SortableHeaderCell,
  TableCard,
} from '@/components/DataTable'
import { RightSidebarToggle, useRightSidebar } from '@/components/layout'
import { applyDirection, toggleSort } from '@/lib/table-sort'
import { getQuizStatusLabel, getQuizStatusBadgeClass } from '@/lib/quizzes'
import { TEACHER_QUIZZES_UPDATED_EVENT } from '@/lib/events'
import { QuizModal } from '@/components/QuizModal'
import { QuizDetailPanel } from '@/components/QuizDetailPanel'
import type { Classroom, QuizWithStats, Quiz } from '@/types'

type SortColumn = 'title' | 'status' | 'responded'

interface Props {
  classroom: Classroom
}

export function TeacherQuizzesTab({ classroom }: Props) {
  const [quizzes, setQuizzes] = useState<QuizWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null)
  const [deleteQuiz, setDeleteQuiz] = useState<{ quiz: QuizWithStats; responsesCount: number } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [{ column: sortColumn, direction: sortDirection }, setSortState] = useState<{
    column: SortColumn
    direction: 'asc' | 'desc'
  }>({ column: 'title', direction: 'asc' })

  const { setOpen: setRightSidebarOpen } = useRightSidebar()

  const loadQuizzes = useCallback(async () => {
    try {
      const res = await fetch(`/api/teacher/quizzes?classroom_id=${classroom.id}`)
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

  const rows = useMemo(() => {
    return [...quizzes].sort((a, b) => {
      if (sortColumn === 'title') {
        return applyDirection(a.title.localeCompare(b.title), sortDirection)
      }
      if (sortColumn === 'status') {
        return applyDirection(a.status.localeCompare(b.status), sortDirection)
      }
      if (sortColumn === 'responded') {
        return applyDirection(a.stats.responded - b.stats.responded, sortDirection)
      }
      return 0
    })
  }, [quizzes, sortColumn, sortDirection])

  const rowKeys = useMemo(() => rows.map((q) => q.id), [rows])

  function handleSort(column: SortColumn) {
    setSortState((prev) => toggleSort(prev, column))
  }

  function handleRowClick(quiz: QuizWithStats) {
    const newSelectedId = selectedQuizId === quiz.id ? null : quiz.id
    setSelectedQuizId(newSelectedId)
    if (newSelectedId) {
      setRightSidebarOpen(true)
    }
  }

  function handleKeyboardSelect(quizId: string) {
    setSelectedQuizId(quizId)
    setRightSidebarOpen(true)
  }

  function handleNewQuiz() {
    setEditingQuiz(null)
    setShowModal(true)
  }

  function handleQuizCreated() {
    setShowModal(false)
    loadQuizzes()
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
      loadQuizzes()
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
    // Get response count for confirmation message
    try {
      const res = await fetch(`/api/teacher/quizzes/${quiz.id}/results`)
      const data = await res.json()
      setDeleteQuiz({ quiz, responsesCount: data.stats?.responded || 0 })
    } catch {
      setDeleteQuiz({ quiz, responsesCount: quiz.stats.responded })
    }
  }

  const selectedQuiz = rows.find((q) => q.id === selectedQuizId)

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <PageLayout>
      <PageActionBar
        primary={
          <Button onClick={handleNewQuiz} variant="primary" className="gap-1.5">
            <Plus className="h-4 w-4" />
            New Quiz
          </Button>
        }
        trailing={<RightSidebarToggle />}
      />

      <PageContent className="flex gap-4">
        <div className="flex-1 min-w-0">
          <KeyboardNavigableTable
            rowKeys={rowKeys}
            selectedKey={selectedQuizId}
            onSelectKey={handleKeyboardSelect}
          >
            <TableCard>
              <DataTable>
                <DataTableHead>
                  <DataTableRow>
                    <SortableHeaderCell
                      label="Title"
                      isActive={sortColumn === 'title'}
                      direction={sortDirection}
                      onClick={() => handleSort('title')}
                    />
                    <SortableHeaderCell
                      label="Status"
                      isActive={sortColumn === 'status'}
                      direction={sortDirection}
                      onClick={() => handleSort('status')}
                    />
                    <DataTableHeaderCell align="center">Questions</DataTableHeaderCell>
                    <SortableHeaderCell
                      label="Responses"
                      isActive={sortColumn === 'responded'}
                      direction={sortDirection}
                      onClick={() => handleSort('responded')}
                      align="center"
                    />
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {rows.map((quiz) => {
                    const isSelected = selectedQuizId === quiz.id

                    return (
                      <DataTableRow
                        key={quiz.id}
                        className={[
                          'cursor-pointer transition-colors',
                          isSelected
                            ? 'bg-info-bg hover:bg-info-bg-hover'
                            : 'hover:bg-surface-hover',
                        ].join(' ')}
                        onClick={() => handleRowClick(quiz)}
                      >
                        <DataTableCell className="font-medium">{quiz.title}</DataTableCell>
                        <DataTableCell>
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getQuizStatusBadgeClass(quiz.status)}`}
                          >
                            {getQuizStatusLabel(quiz.status)}
                          </span>
                        </DataTableCell>
                        <DataTableCell align="center" className="text-text-muted">
                          {quiz.stats.questions_count}
                        </DataTableCell>
                        <DataTableCell align="center" className="text-text-muted">
                          {quiz.stats.responded}/{quiz.stats.total_students}
                        </DataTableCell>
                      </DataTableRow>
                    )
                  })}
                  {rows.length === 0 && (
                    <EmptyStateRow colSpan={4} message="No quizzes yet. Create one to get started." />
                  )}
                </DataTableBody>
              </DataTable>
            </TableCard>
          </KeyboardNavigableTable>
        </div>
      </PageContent>

      <QuizModal
        isOpen={showModal}
        classroomId={classroom.id}
        quiz={editingQuiz}
        onClose={() => setShowModal(false)}
        onSuccess={handleQuizCreated}
      />

      {selectedQuiz && (
        <QuizDetailPanel
          quiz={selectedQuiz}
          classroomId={classroom.id}
          onQuizUpdate={loadQuizzes}
          onDelete={() => handleRequestDelete(selectedQuiz)}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteQuiz}
        title="Delete quiz?"
        description={
          deleteQuiz && deleteQuiz.responsesCount > 0
            ? `This quiz has ${deleteQuiz.responsesCount} response${deleteQuiz.responsesCount === 1 ? '' : 's'}. Deleting it will permanently remove all student responses.`
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
