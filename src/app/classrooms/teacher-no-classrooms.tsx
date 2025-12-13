'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
import type { Classroom } from '@/types'

export function TeacherNoClassrooms() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(true)

  function onSuccess(classroom: Classroom) {
    setIsOpen(false)
    router.push(`/classrooms/${classroom.id}?tab=attendance`)
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="bg-white rounded-lg shadow-sm p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900">Create your first classroom</h1>
        <p className="text-gray-600 mt-2">
          Once you create a classroom, you’ll manage attendance, logs, roster, and assignments from the classroom shell.
        </p>
        <div className="mt-6">
          <button
            type="button"
            className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700"
            onClick={() => setIsOpen(true)}
          >
            Create classroom
          </button>
        </div>
      </div>

      <CreateClassroomModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onSuccess={onSuccess}
      />
    </div>
  )
}

