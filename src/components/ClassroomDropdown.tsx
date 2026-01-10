'use client'

import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'

interface ClassroomDropdownProps {
  classrooms: Array<{
    id: string
    title: string
    code: string
  }>
  currentClassroomId?: string
  currentTab?: string
}

/**
 * Classroom selector dropdown for quick switching between classrooms.
 * Replaces need for repeated classroom titles in page headers.
 */
export function ClassroomDropdown({
  classrooms,
  currentClassroomId,
  currentTab,
}: ClassroomDropdownProps) {
  const router = useRouter()

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const classroomId = e.target.value
    const nextUrl = currentTab
      ? `/classrooms/${classroomId}?tab=${encodeURIComponent(currentTab)}`
      : `/classrooms/${classroomId}`
    router.push(nextUrl)
  }

  if (classrooms.length === 0) {
    return null
  }

  // If only one classroom, show as text instead of dropdown
  if (classrooms.length === 1) {
    return (
      <div className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate max-w-xs">
        {classrooms[0].title}
      </div>
    )
  }

  return (
    <div className="relative">
      <select
        value={currentClassroomId || classrooms[0].id}
        onChange={handleChange}
        className="h-10 pl-3 pr-8 text-sm sm:text-base font-semibold border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none max-w-xs truncate"
      >
        {classrooms.map((classroom) => (
          <option key={classroom.id} value={classroom.id}>
            {classroom.title}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400 pointer-events-none" />
    </div>
  )
}
