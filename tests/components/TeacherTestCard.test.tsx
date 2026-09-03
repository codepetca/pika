import { render, screen } from '@testing-library/react'
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
