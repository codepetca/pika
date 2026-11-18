'use client'
import { AttendanceWindowDialog } from '@/app/classrooms/[classroomId]/AttendanceWindowDialog'
import { TeacherAttendanceRoomsDialog } from '@/app/classrooms/[classroomId]/TeacherAttendanceRoomsDialog'
export function TeacherRoomFixture({ schedules = false }: { schedules?: boolean }) {
  if (schedules) return <AttendanceWindowDialog classroomId="30000000-0000-4000-8000-000000000001" date="2026-11-13" isOpen roomAttendanceAvailable onClose={() => {}} onSaved={() => {}} />
  return <TeacherAttendanceRoomsDialog classroomId="30000000-0000-4000-8000-000000000001" date="2026-11-13" isOpen onClose={() => {}} />
}
