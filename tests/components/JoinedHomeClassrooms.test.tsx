import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { JoinedHomeClassrooms } from '@/app/classrooms/JoinedHomeClassrooms'
import { TooltipProvider } from '@/ui'

const row = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Joined science', class_code: 'SCI26',
  theme_color: 'violet' as const, term_label: null, start_date: null, end_date: null,
  updated_at: '2026-10-23T12:00:00Z', relationship: 'member' as const,
  enrollment_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}
describe('JoinedHomeClassrooms', () => {
  it('names the joined section and offers no owner/archive controls', () => {
    const onOpen = vi.fn(), onVisibility = vi.fn()
    render(<TooltipProvider><JoinedHomeClassrooms rows={[row]} hidden={false} editing busy={false} onOpen={onOpen} onVisibility={onVisibility} /></TooltipProvider>)
    expect(screen.getByRole('region', { name: 'Joined classrooms' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Archive|Drag to reorder/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Joined science Semester dates/ }))
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(row.id)
    fireEvent.click(screen.getByRole('button', { name: 'Hide Joined science' }))
    expect(onVisibility).toHaveBeenCalledExactlyOnceWith(row, true)
  })
  it('shows unhide rather than archive or leave in Hidden', () => {
    const onVisibility = vi.fn()
    render(<TooltipProvider><JoinedHomeClassrooms rows={[row]} hidden editing={false} busy={false} onOpen={vi.fn()} onVisibility={onVisibility} /></TooltipProvider>)
    expect(screen.getByRole('region', { name: 'Hidden classrooms' })).toHaveTextContent('You’re still a member.')
    fireEvent.click(screen.getByRole('button', { name: 'Unhide Joined science' }))
    expect(onVisibility).toHaveBeenCalledExactlyOnceWith(row, false)
    expect(screen.queryByRole('button', { name: /Hide Joined science|Archive|Leave/ })).not.toBeInTheDocument()
  })
  it('disables navigation and personal actions during a pending mutation', () => {
    const onOpen = vi.fn(), onVisibility = vi.fn()
    render(<TooltipProvider><JoinedHomeClassrooms rows={[row]} hidden={false} editing busy onOpen={onOpen} onVisibility={onVisibility} /></TooltipProvider>)
    for (const button of screen.getAllByRole('button')) { expect(button).toBeDisabled(); fireEvent.click(button) }
    expect(onOpen).not.toHaveBeenCalled()
    expect(onVisibility).not.toHaveBeenCalled()
  })
  it('omits an empty active group but retains the archived-page Hidden empty state', () => {
    const view = (hidden: boolean) => <JoinedHomeClassrooms rows={[]} hidden={hidden} editing={false} busy={false} onOpen={vi.fn()} onVisibility={vi.fn()} />
    const { rerender } = render(view(false))
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    rerender(view(true))
    expect(screen.getByRole('region', { name: 'Hidden classrooms' })).toHaveTextContent('No hidden classrooms')
  })
})
