import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ColdClassroomArchiveRow } from '@/components/ColdClassroomArchiveRow'

const archive = {
  classroom_id: '00000000-0000-4000-8000-000000000001',
  archive_id: '00000000-0000-4000-8000-000000000002',
  title: 'Stored history classroom',
  archived_at: '2026-07-02T02:00:00.000Z',
  compacted_at: '2026-07-10T12:00:00.000Z',
}

describe('ColdClassroomArchiveRow', () => {
  it('labels stored recovery metadata and disables unavailable restore', () => {
    render(
      <ColdClassroomArchiveRow
        archive={archive}
        restoreEnabled={false}
        onRestore={vi.fn()}
      />,
    )

    expect(screen.getByText(archive.title)).toBeInTheDocument()
    expect(screen.getByText('Stored archive')).toBeInTheDocument()
    expect(screen.getByText('Archived Jul 1, 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore' })).toHaveAttribute(
      'title',
      'Restore is not enabled for this classroom',
    )
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled()
  })

  it('invokes restore from the enabled accessible control', () => {
    const onRestore = vi.fn()
    render(
      <ColdClassroomArchiveRow
        archive={archive}
        restoreEnabled
        onRestore={onRestore}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    expect(onRestore).toHaveBeenCalledOnce()
  })
})
