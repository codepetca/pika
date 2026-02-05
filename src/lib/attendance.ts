import type { AttendanceStatus, ClassDay, Entry, AttendanceRecord } from '@/types'

/**
 * Checks if an entry has actual content (non-whitespace text)
 */
function entryHasContent(entry: Entry): boolean {
  return entry.text.trim().length > 0
}

/**
 * Computes attendance status for a single student across all class days
 * Pure function - no side effects
 *
 * @param classDays - All class days for the classroom
 * @param entries - All entries for the student
 * @param today - Today's date in YYYY-MM-DD format (Toronto timezone)
 *
 * Status logic:
 * - present: entry exists with content for that class day
 * - absent: past class day with no entry or empty entry
 * - pending: today or future class day with no entry or empty entry yet
 */
export function computeAttendanceStatusForStudent(
  classDays: ClassDay[],
  entries: Entry[],
  today: string
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

    if (entry && entryHasContent(entry)) {
      result[classDay.date] = 'present'
    } else if (classDay.date >= today) {
      // Today or future: pending (student still has time to submit)
      result[classDay.date] = 'pending'
    } else {
      // Past class day with no entry: absent
      result[classDay.date] = 'absent'
    }
  })

  return result
}

/**
 * Computes attendance records for multiple students
 *
 * @param students - Students to compute attendance for
 * @param classDays - All class days for the classroom
 * @param allEntries - All entries for the classroom
 * @param today - Today's date in YYYY-MM-DD format (Toronto timezone)
 */
export function computeAttendanceRecords(
  students: Array<{ id: string; email: string; first_name: string; last_name: string }>,
  classDays: ClassDay[],
  allEntries: Entry[],
  today: string
): AttendanceRecord[] {
  return students.map(student => {
    // Filter entries for this student
    const studentEntries = allEntries.filter(e => e.student_id === student.id)

    // Compute attendance status
    const dates = computeAttendanceStatusForStudent(classDays, studentEntries, today)

    // Calculate summary stats (only count present and absent, not pending)
    const summary = {
      present: 0,
      absent: 0
    }

    Object.values(dates).forEach(status => {
      if (status === 'present' || status === 'absent') {
        summary[status]++
      }
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
    case 'pending':
      return '⚪'
  }
}

/**
 * Gets dot color class for attendance status indicator
 * Green = present, Red = absent, Gray = pending
 */
export function getAttendanceDotClass(status: AttendanceStatus): string {
  switch (status) {
    case 'present':
      return 'bg-green-500'
    case 'absent':
      return 'bg-red-500'
    case 'pending':
      return 'bg-gray-400'
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
    case 'pending':
      return 'Pending'
  }
}
