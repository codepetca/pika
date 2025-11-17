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
    } else if (entry.on_time) {
      result[classDay.date] = 'present'
    } else {
      result[classDay.date] = 'late'
    }
  })

  return result
}

/**
 * Computes attendance records for multiple students
 */
export function computeAttendanceRecords(
  students: Array<{ id: string; email: string }>,
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
      late: 0,
      absent: 0
    }

    Object.values(dates).forEach(status => {
      summary[status]++
    })

    return {
      student_email: student.email,
      student_id: student.id,
      dates,
      summary
    }
  })
}

/**
 * Gets icon for attendance status
 */
export function getAttendanceIcon(status: AttendanceStatus): string {
  switch (status) {
    case 'present':
      return '🟢'
    case 'late':
      return '🟡'
    case 'absent':
      return '🔴'
  }
}

/**
 * Gets label for attendance status
 */
export function getAttendanceLabel(status: AttendanceStatus): string {
  switch (status) {
    case 'present':
      return 'Present'
    case 'late':
      return 'Late'
    case 'absent':
      return 'Absent'
  }
}
