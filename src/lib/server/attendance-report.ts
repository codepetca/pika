import type { ClassDay, Entry } from '@/types'
import { loadChunkedRows } from '@/lib/server/query-chunks'
import {
  loadClassroomRoster,
  type ClassroomRosterStudent,
} from '@/lib/server/classroom-roster'

const ATTENDANCE_REPORT_PAGE_SIZE = 1000

export type AttendanceReportStudent = ClassroomRosterStudent

type AttendanceRosterResult = {
  students: AttendanceReportStudent[]
  studentIds: string[]
  enrollmentsError: any
  profilesError: any
}

export async function loadAttendanceClassDays(
  supabase: any,
  classroomId: string,
): Promise<{ rows: ClassDay[]; error: any }> {
  return loadChunkedRows<ClassDay>({
    supabase,
    table: 'class_days',
    select: '*',
    filters: [{ column: 'classroom_id', values: [classroomId] }],
    pageSize: ATTENDANCE_REPORT_PAGE_SIZE,
    pageOrderColumn: 'date',
  })
}

export async function loadAttendanceRoster(
  supabase: any,
  classroomId: string,
): Promise<AttendanceRosterResult> {
  return loadClassroomRoster(supabase, classroomId)
}

export async function loadAttendanceEntries(
  supabase: any,
  classroomId: string,
  studentIds: string[],
): Promise<{ rows: Entry[]; error: any }> {
  if (studentIds.length === 0) {
    return { rows: [], error: null }
  }

  return loadChunkedRows<Entry>({
    supabase,
    table: 'entries',
    select: '*',
    filters: [
      { column: 'classroom_id', values: [classroomId] },
      { column: 'student_id', values: studentIds },
    ],
    pageSize: ATTENDANCE_REPORT_PAGE_SIZE,
    pageOrderColumn: 'id',
  })
}
