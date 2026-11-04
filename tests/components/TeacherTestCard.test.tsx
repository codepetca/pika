import { render, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TeacherTestCard } from '@/components/TeacherTestCard'
import { TooltipProvider } from '@/ui'
import { createMockTest } from '../helpers/mocks'

describe('TeacherTestCard Preview', () => {
  it('keeps read-only preview named and keyboard accessible without selecting the editor', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onRequestPreview = vi.fn()
    render(
      <TeacherTestCard
        test={{ ...createMockTest({ title: 'Unit Test' }), stats: { total_students: 2, responded: 0, questions_count: 3 } }}
        isReadOnly
        editMode={false}
        onSelect={onSelect}
        onRequestPreview={onRequestPreview}
        onRequestDelete={vi.fn()}
      />,
      { wrapper: TooltipProvider },
    )
    const preview = screen.getByRole('button', { name: 'Preview Unit Test' })
    expect(preview).toBeEnabled()
    expect(preview).toHaveTextContent(/^$/)
    preview.focus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Preview Unit Test')
    await user.keyboard('{Enter}')
    expect(onRequestPreview).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('TeacherTestCard', () => {
  it('exposes unknown counts and prevents opening the workspace before statistics load', () => {
    const test = createMockTest({ title: 'Test title', status: 'active' })
    render(<DndContext><SortableContext items={[test.id]}><TeacherTestCard test={test} statsPending isReadOnly editMode={false}
      onSelect={vi.fn()} onRequestPreview={vi.fn()} onRequestDelete={vi.fn()} /></SortableContext></DndContext>, { wrapper: TooltipProvider })
    expect(screen.getByRole('button', { name: 'Test title' })).toBeDisabled()
    expect(screen.getByLabelText('Submitted count loading')).toHaveTextContent('—/—')
    expect(screen.getByText('Checking access')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview Test title' })).toBeEnabled()
  })

  it.each([
    { status: 'active' as const, open: 1, closed: 1, label: 'Open' },
    { status: 'active' as const, open: 0, closed: 2, label: 'Closed' },
    { status: 'draft' as const, open: 0, closed: 2, label: 'Draft' },
  ])('shows $label alongside the accessible submission fraction', ({ status, open, closed, label }) => {
    const test = { ...createMockTest({ title: 'Unit Test', status }), stats: { total_students: 2, submitted: 1, responded: 1, questions_count: 3, open_access: open, closed_access: closed } }
    render(<TeacherTestCard test={test} isReadOnly editMode={false}
      onSelect={vi.fn()} onRequestPreview={vi.fn()} onRequestDelete={vi.fn()} />, { wrapper: TooltipProvider })
    expect(screen.getByRole('img', { name: '1 of 2 submitted' })).toHaveTextContent('1/2')
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.queryByLabelText('1 open')).not.toBeInTheDocument()
  })

  it('does not present unavailable access or counts as known', () => {
    const test = createMockTest({ title: 'Unit Test', status: 'active' })
    render(<TeacherTestCard test={test} statsPending statsUnavailable isReadOnly editMode={false}
      onSelect={vi.fn()} onRequestPreview={vi.fn()} onRequestDelete={vi.fn()} />, { wrapper: TooltipProvider })
    expect(screen.getByLabelText('Submitted count unavailable')).toHaveTextContent('—/—')
    expect(screen.getByText('Access unavailable')).toBeInTheDocument()
  })

  it('shows a future test date while preserving Draft status', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-03T15:00:00Z'))
    try {
      const test = { ...createMockTest({ title: 'Scheduled draft', status: 'draft', test_date: '2026-11-10' }), stats: { total_students: 2, responded: 0, questions_count: 1 } }
      render(<TeacherTestCard test={test} isReadOnly editMode={false}
        onSelect={vi.fn()} onRequestPreview={vi.fn()} onRequestDelete={vi.fn()} />, { wrapper: TooltipProvider })
      expect(screen.getByText('Nov 10, 2026')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Scheduled draft, test date November 10, 2026' })).toBeInTheDocument()
      expect(screen.getByText('Draft')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
