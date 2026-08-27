import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TeacherSelectionBar } from '@/components/teacher-work-surface/TeacherSelectionBar'
import { TeacherWorkSurfaceContextBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceContextBar'
import { TeacherWorkSurfaceTableFrame } from '@/components/teacher-work-surface/TeacherWorkSurfaceTableFrame'

describe('TeacherWorkSurfaceContextBar', () => {
  it('keeps the primary control in the centered grid slot and context visually quiet', () => {
    render(
      <TeacherWorkSurfaceContextBar
        ariaLabel="Attendance controls and summary"
        context="Closed · 10:00–11:00"
        primary={<button type="button">Aug 26</button>}
        summary={<span>18 present</span>}
        actions={<button type="button">Refresh</button>}
      />,
    )

    const region = screen.getByRole('region', { name: 'Attendance controls and summary' })
    expect(region).toHaveClass(
      'grid',
      'grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]',
    )
    expect(region).not.toHaveClass('bg-surface', 'border')
    expect(screen.getByText('Closed · 10:00–11:00')).toHaveClass(
      'justify-self-start',
      'text-text-muted',
    )
    expect(screen.getByRole('button', { name: 'Aug 26' }).parentElement).toHaveClass(
      'justify-self-center',
      'bg-surface/95',
      'shadow-elevated',
    )
    expect(screen.getByText('18 present').parentElement).toHaveClass('hidden', 'xl:flex')
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
  })
})

describe('TeacherSelectionBar', () => {
  it('appears only for an active selection and provides a shared clear action', () => {
    const onClear = vi.fn()
    const { rerender } = render(
      <TeacherSelectionBar selectedCount={0} onClear={onClear}>
        <button type="button">Present</button>
      </TeacherSelectionBar>,
    )

    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()

    rerender(
      <TeacherSelectionBar
        selectedCount={3}
        onClear={onClear}
        ariaLabel="Bulk attendance actions"
      >
        <button type="button">Present</button>
      </TeacherSelectionBar>,
    )

    expect(screen.getByRole('toolbar', { name: 'Bulk attendance actions' })).toHaveTextContent(
      '3 selected',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(onClear).toHaveBeenCalledOnce()
  })
})

describe('TeacherWorkSurfaceTableFrame', () => {
  it('reserves bottom scroll clearance only while selection actions are active', () => {
    const { container, rerender } = render(
      <TeacherWorkSurfaceTableFrame>
        <div>Rows</div>
      </TeacherWorkSurfaceTableFrame>,
    )

    expect(container.firstChild).toHaveClass('overflow-auto')
    expect(container.firstChild).not.toHaveClass('pb-20')

    rerender(
      <TeacherWorkSurfaceTableFrame selectionActive>
        <div>Rows</div>
      </TeacherWorkSurfaceTableFrame>,
    )

    expect(container.firstChild).toHaveClass('pb-32', 'sm:pb-20')
  })
})
