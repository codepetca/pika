'use client'
import { TeacherAttendanceRoomsDialog } from '@/app/classrooms/[classroomId]/TeacherAttendanceRoomsDialog'
export function TeacherRoomFixture() {
  return <TeacherAttendanceRoomsDialog classroomId="30000000-0000-4000-8000-000000000001" date="2026-11-13" isOpen onClose={() => {}} />
}
