'use client'

import { useState, useCallback } from 'react'
import type { Classroom } from '@/types'

interface UseDeleteClassroomOptions {
  onSuccess: (deletedId: string) => void
  onError: (message: string) => void
}

export function useDeleteClassroom({ onSuccess, onError }: UseDeleteClassroomOptions) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [classroomToDelete, setClassroomToDelete] = useState<Classroom | null>(null)

  const requestDelete = useCallback((classroom: Classroom) => {
    setClassroomToDelete(classroom)
    setConfirmOpen(true)
  }, [])

  const cancelDelete = useCallback(() => {
    setConfirmOpen(false)
    setClassroomToDelete(null)
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!classroomToDelete) return

    setConfirmOpen(false)

    try {
      const response = await fetch(`/api/teacher/classrooms/${classroomToDelete.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        onError(data.error || 'Failed to delete classroom')
        return
      }

      onSuccess(classroomToDelete.id)
    } catch (err) {
      console.error('Error deleting classroom:', err)
      onError('An error occurred while deleting the classroom')
    } finally {
      setClassroomToDelete(null)
    }
  }, [classroomToDelete, onSuccess, onError])

  const confirmDialogProps = {
    isOpen: confirmOpen,
    title: 'Delete Classroom',
    description: classroomToDelete
      ? `Are you sure you want to delete "${classroomToDelete.title}"?\n\nThis will permanently delete:\n- The classroom\n- All student enrollments\n- All class days and calendar\n- All student entries\n\nThis action cannot be undone.`
      : '',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    confirmVariant: 'danger' as const,
    onConfirm: confirmDelete,
    onCancel: cancelDelete,
  }

  return {
    requestDelete,
    confirmDialogProps,
  }
}
