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
    expect(screen.getByLabelText('Open count loading')).toHaveTextContent('—')
    expect(screen.getByLabelText('Closed count loading')).toHaveTextContent('—')
    expect(screen.getByText('Checking access')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview Test title' })).toBeEnabled()
  })
})
