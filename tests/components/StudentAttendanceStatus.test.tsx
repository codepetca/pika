import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  resolveVisibleStudentAttendanceState,
  StudentAttendanceStatus,
} from '@/components/StudentAttendanceStatus'

const classroomOne = '20000000-0000-4000-8000-000000000001'

describe('StudentAttendanceStatus', () => {
  afterEach(() => vi.clearAllMocks())

  it('shows the QR-preserving prompt only in the matching open classroom', () => {
    render(<StudentAttendanceStatus
      state={{ classroomId: classroomOne, state: 'open', opensAt: null, closesAt: null }}
      variant="banner"
    />)

    expect(screen.getByText('Attendance check-in is open')).toBeInTheDocument()
    expect(screen.getByText('Scan the QR shown by your teacher.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows only the student’s own confirmed status and Toronto time', () => {
    render(<StudentAttendanceStatus
      state={{
        classroomId: classroomOne,
        state: 'confirmed',
        opensAt: null,
        closesAt: null,
        attendanceStatus: 'late',
        confirmedAt: '2026-08-23T13:07:00.000Z',
      }}
      variant="banner"
    />)

    expect(screen.getByText('Checked in — Late')).toBeInTheDocument()
    expect(screen.getByText(/Confirmed at 9:07 a\.m\. EDT\./i)).toBeInTheDocument()
  })

  it('suppresses an open prompt at the known close instant', () => {
    expect(resolveVisibleStudentAttendanceState({
      classroomId: classroomOne,
      state: 'open',
      opensAt: '2026-08-23T13:00:00.000Z',
      closesAt: '2026-08-23T14:00:00.000Z',
    }, new Date('2026-08-23T14:00:00.000Z'))).toBeNull()
  })
})
