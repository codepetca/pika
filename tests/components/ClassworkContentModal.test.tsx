import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  ClassworkModalSaveStatus,
  ClassworkModalSplitAction,
  ClassworkModalTopLine,
} from '@/components/classwork/ClassworkContentModal'
import { ClassworkDueFields } from '@/components/classwork/ClassworkDueFields'

describe('ClassworkContentModal presentation primitives', () => {
  it('composes title, status, due controls, and publication actions without domain state', () => {
    const onTitleChange = vi.fn()
    const onDueDateChange = vi.fn()
    const onDueTimeChange = vi.fn()
    const onPrimaryClick = vi.fn()

    render(
      <ClassworkModalTopLine
        title="Weekly reflection"
        titlePlaceholder="Enter title"
        titleStatus={<ClassworkModalSaveStatus status="saved" />}
        onTitleChange={onTitleChange}
        meta={(
          <ClassworkDueFields
            dueDate="2026-07-14"
            dueTime="15:30"
            onDueDateChange={onDueDateChange}
            onDueTimeChange={onDueTimeChange}
          />
        )}
        primaryActions={(
          <ClassworkModalSplitAction
            label="Post"
            intent="publish"
            onPrimaryClick={onPrimaryClick}
            toggleAriaLabel="Choose classwork action"
            options={[{ id: 'schedule', label: 'Schedule...', onSelect: vi.fn() }]}
          />
        )}
      />
    )

    expect(screen.getByRole('textbox', { name: /Title/ })).toHaveValue('Weekly reflection')
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.getByText('Due')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose classwork action' })).toHaveAttribute('aria-haspopup', 'menu')

    fireEvent.change(screen.getByRole('textbox', { name: /Title/ }), { target: { value: 'Updated reflection' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    expect(onTitleChange).toHaveBeenCalledWith('Updated reflection')
    expect(onPrimaryClick).toHaveBeenCalled()
  })
})
