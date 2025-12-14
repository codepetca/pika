'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
import type { Classroom } from '@/types'

interface Props {
  initialClassrooms: Classroom[]
}

export function TeacherClassroomsIndex({ initialClassrooms }: Props) {
  const router = useRouter()
  const [classrooms, setClassrooms] = useState<Classroom[]>(initialClassrooms)
  const [showCreate, setShowCreate] = useState(false)

  const sorted = useMemo(() => {
    return [...classrooms].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }, [classrooms])

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Classrooms</h1>
          <p className="text-gray-600 mt-1">Open a classroom to manage attendance, logs, roster, and assignments.</p>
        </div>
        <button
          type="button"
          className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700"
          onClick={() => setShowCreate(true)}
        >
          + New classroom
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm p-10 text-center">
          <h2 className="text-lg font-semibold text-gray-900">No classrooms yet</h2>
          <p className="text-gray-600 mt-2">Create your first classroom to get started.</p>
          <div className="mt-6">
            <button
              type="button"
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700"
              onClick={() => setShowCreate(true)}
            >
              Create classroom
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm divide-y divide-gray-100">
          {sorted.map((c) => (
            <div key={c.id} className="p-4 flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900">{c.title}</div>
                <div className="mt-1 text-sm text-gray-600">
                  Code: <span className="font-mono">{c.class_code}</span>
                  {c.term_label ? ` • ${c.term_label}` : ''}
                </div>
              </div>
              <Link
                href={`/classrooms/${c.id}?tab=attendance`}
                className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm hover:bg-gray-50"
              >
                Open
              </Link>
            </div>
          ))}
        </div>
      )}

      <CreateClassroomModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={(created) => {
          setShowCreate(false)
          setClassrooms((prev) => [created, ...prev])
          router.push(`/classrooms/${created.id}?tab=attendance`)
        }}
      />
    </div>
  )
}

