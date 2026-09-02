import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  AttendanceMarkButton,
  AttendanceStatusControl,
  AttendanceStatusSortChip,
} from '@/app/classrooms/[classroomId]/TeacherAttendanceControls'
import { TooltipProvider } from '@/ui'

describe('TeacherAttendanceControls', () => {
  it('keeps the compact circles named, keyboard-operable, and disabled during saves', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<AttendanceStatusControl studentName="Blair" status="late" disabled={false} onChange={onChange} />, { wrapper: TooltipProvider })
    const group = screen.getByRole('group', { name: 'Attendance status for Blair' })
    const late = within(group).getByRole('button', { name: 'Late' })
    expect(late).toHaveAttribute('aria-pressed', 'true')
    late.focus()
    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('present')

    onChange.mockClear()
    rerender(<AttendanceStatusControl studentName="Blair" status="late" disabled onChange={onChange} />)
    for (const button of within(group).getAllByRole('button')) expect(button).toBeDisabled()
    await user.click(within(group).getByRole('button', { name: 'Absent' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('names compact row marks and exposes the active attendance sort', async () => {
    const user = userEvent.setup()
    const onMark = vi.fn()
    const onSort = vi.fn()
    render(
      <>
        <AttendanceMarkButton
          studentName="Blair Chen"
          status="present"
          active
          disabled={false}
          onClick={onMark}
        />
        <AttendanceStatusSortChip
          status="present"
          count={2}
          active
          onClick={onSort}
          tooltipContent="2 Present"
          showSortIndicator
        />
      </>,
      { wrapper: TooltipProvider },
    )

    const mark = screen.getByRole('button', { name: 'Mark Blair Chen present' })
    expect(mark).toHaveAttribute('aria-pressed', 'true')
    await user.click(mark)
    expect(onMark).toHaveBeenCalledOnce()

    const sort = screen.getByRole('button', { name: 'Sort Present first, 2 students' })
    expect(sort).toHaveAttribute('aria-pressed', 'true')
    expect(sort.querySelector('svg')).toBeInTheDocument()
    await user.click(sort)
    expect(onSort).toHaveBeenCalledOnce()
  })
})
