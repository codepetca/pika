import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GradebookEditorDialog } from '@/components/gradebook/GradebookDialogs'
import { TooltipProvider } from '@/ui'

const categories = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Attendance',
    percentage: 10,
    default_assessment_weight: 10,
    position: 0,
    is_default: false,
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    name: 'Term',
    percentage: 65,
    default_assessment_weight: 10,
    position: 1,
    is_default: true,
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    name: 'Final',
    percentage: 25,
    default_assessment_weight: 10,
    position: 2,
    is_default: false,
  },
]

describe('GradebookEditorDialog', () => {
  it('reorders categories with named controls and saves normalized positions', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <TooltipProvider>
        <GradebookEditorDialog
          isOpen
          categories={categories}
          isSaving={false}
          onClose={() => undefined}
          onSave={onSave}
        />
      </TooltipProvider>,
    )

    expect(screen.getByRole('button', { name: 'Move Attendance up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Final down' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Move Term up' }))
    expect(screen.getAllByRole('textbox', { name: 'Category name' }).map((input) => (
      (input as HTMLInputElement).value
    ))).toEqual(['Term', 'Attendance', 'Final'])

    await user.click(screen.getByRole('button', { name: 'Save gradebook' }))
    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'Term', position: 0 }),
      expect.objectContaining({ name: 'Attendance', position: 1 }),
      expect.objectContaining({ name: 'Final', position: 2 }),
    ])
  })
})
