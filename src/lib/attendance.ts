import type { AttendanceStatus, ClassDay, Entry, AttendanceRecord } from '@/types'

/**
 * Computes attendance status for a single student across all class days
 * Pure function - no side effects
 */
export function computeAttendanceStatusForStudent(
  classDays: ClassDay[],
  entries: Entry[]
): Record<string, AttendanceStatus> {
  const result: Record<string, AttendanceStatus> = {}

  // Only consider actual class days
  const actualClassDays = classDays.filter(day => day.is_class_day)

  // Create a map of entries by date for quick lookup
  const entryMap = new Map<string, Entry>()
  entries.forEach(entry => {
    entryMap.set(entry.date, entry)
  })

  // Compute status for each class day
  actualClassDays.forEach(classDay => {
    const entry = entryMap.get(classDay.date)

    if (!entry) {
      result[classDay.date] = 'absent'
    } else {
      result[classDay.date] = 'present'
    }
  })

  return result
}

/**
 * Computes attendance records for multiple students
 */
export function computeAttendanceRecords(
  students: Array<{ id: string; email: string; first_name: string; last_name: string }>,
  classDays: ClassDay[],
  allEntries: Entry[]
): AttendanceRecord[] {
  return students.map(student => {
    // Filter entries for this student
    const studentEntries = allEntries.filter(e => e.student_id === student.id)

    // Compute attendance status
    const dates = computeAttendanceStatusForStudent(classDays, studentEntries)

    // Calculate summary stats
    const summary = {
      present: 0,
      absent: 0
    }

    Object.values(dates).forEach(status => {
      summary[status]++
    })

    return {
      student_email: student.email,
      student_id: student.id,
      student_first_name: student.first_name,
      student_last_name: student.last_name,
      dates,
      summary
    }
  })
}

/**
 * Gets icon for attendance status (emoji)
 */
export function getAttendanceIcon(status: AttendanceStatus): string {
  switch (status) {
    case 'present':
      return '🟢'
    case 'absent':
      return '🔴'
  }
}

/**
 * Gets dot color class for attendance status indicator
 * Green = present, Red = absent
 */
export function getAttendanceDotClass(status: AttendanceStatus): string {
  switch (status) {
    case 'present':
      return 'bg-green-500'
    case 'absent':
      return 'bg-red-500'
  }
}

/**
 * Gets label for attendance status
 */
export function getAttendanceLabel(status: AttendanceStatus): string {
  switch (status) {
    case 'present':
      return 'Present'
    case 'absent':
      return 'Absent'
  }
}
