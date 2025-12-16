'use client'

import { useRouter } from 'next/navigation'
import { ChevronDownIcon } from '@heroicons/react/20/solid'

interface ClassroomDropdownProps {
  classrooms: Array<{
    id: string
    title: string
    code: string
  }>
  currentClassroomId?: string
}

/**
 * Classroom selector dropdown for quick switching between classrooms.
 * Replaces need for repeated classroom titles in page headers.
 */
export function ClassroomDropdown({
  classrooms,
  currentClassroomId,
}: ClassroomDropdownProps) {
  const router = useRouter()

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const classroomId = e.target.value
    router.push(`/classrooms/${classroomId}`)
  }

  if (classrooms.length === 0) {
    return null
  }

  // If only one classroom, show as text instead of dropdown
  if (classrooms.length === 1) {
    return (
      <div className="text-sm font-medium text-gray-900 truncate max-w-xs">
        {classrooms[0].title}
      </div>
    )
  }

  return (
    <div className="relative">
      <select
        value={currentClassroomId || classrooms[0].id}
        onChange={handleChange}
        className="h-9 pl-3 pr-8 text-sm border border-gray-300 rounded-md bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none max-w-xs truncate"
      >
        {classrooms.map((classroom) => (
          <option key={classroom.id} value={classroom.id}>
            {classroom.title}
          </option>
        ))}
      </select>
      <ChevronDownIcon className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
    </div>
  )
}
