import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GradebookCategoryEditor as GradebookEditorDialog } from '@/components/gradebook/GradebookCategoryEditor'
import { GradebookAssessmentEditor } from '@/components/gradebook/GradebookAssessmentEditor'
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
  it('uses drag handles, locks percentages, and saves normalized positions', async () => {
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

    expect(screen.getByRole('button', { name: 'Drag to reorder Term' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Lock Term course percentage' }))
    expect(screen.getByRole('spinbutton', { name: 'Course percentage for Term' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save categories' }))
    expect(onSave).toHaveBeenCalledWith(categories)

  })
  it('preserves legacy percentages until an explicit conversion', () => {
    const onSave = vi.fn()
    const legacy = categories.map((category, index) => ({ ...category, percentage: [33.33, 33.33, 33.34][index] }))
    render(<TooltipProvider><GradebookEditorDialog isOpen categories={legacy} onSave={onSave} onClose={() => {}} /></TooltipProvider>)
    expect(screen.getByRole('spinbutton', { name: 'Course percentage for Term' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save categories' }))
    expect(onSave).toHaveBeenLastCalledWith(legacy)
    fireEvent.click(screen.getByRole('button', { name: 'Convert to 0.5% steps' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save categories' }))
    expect(onSave.mock.lastCall?.[0].map((category: { percentage: number }) => category.percentage)).toEqual([33.5, 33, 33.5])
  })

  it('disables edits and dismissal while saving, and surfaces save errors', () => {
    const onClose = vi.fn()
    render(<TooltipProvider><GradebookEditorDialog isOpen categories={categories} isSaving error="Could not save" onSave={vi.fn()} onClose={onClose} /></TooltipProvider>)
    expect(screen.getByRole('textbox', { name: 'Category name for Term' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add category' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save')
  })
})

describe('GradebookAssessmentEditor', () => {
  const assessment = { assessment_id: 'a1', assessment_type: 'assignment' as const, title: 'Essay', code: 'A1', possible: 30, weight: 20, include_in_final: true, category_id: categories[1].id }

  it('allows existing duplicate titles without blocking category-only edits', () => {
    const onSave = vi.fn()
    render(<GradebookAssessmentEditor isOpen assessment={assessment} assessments={[assessment, { ...assessment, assessment_type: 'test' }]} categories={categories} onClose={vi.fn()} onSave={onSave} />)
    expect(screen.getByRole('dialog', { name: 'Edit assessment' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: '' } })
    expect(screen.getByRole('spinbutton', { name: 'Category weight' })).toHaveValue(20)
    expect(screen.getByRole('textbox', { name: 'Course weight' })).toHaveValue('Not counted')
    fireEvent.click(screen.getByRole('button', { name: 'Save assessment' }))
    expect(onSave).toHaveBeenCalledWith('Essay', null, 20)
  })

  it('exposes a partial-save error and disables editing and closing while saving', () => {
    const onClose = vi.fn()
    render(<GradebookAssessmentEditor isOpen isSaving error="Title saved; category save failed" assessment={assessment} assessments={[assessment]} categories={categories} onClose={onClose} onSave={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'Assessment title' })).toBeDisabled()
    expect(screen.getByRole('spinbutton', { name: 'Category weight' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Title saved; category save failed')
  })
})
