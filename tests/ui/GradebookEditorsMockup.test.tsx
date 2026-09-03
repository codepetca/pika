import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GradebookAssessmentEditorMockup } from '@/app/__ui/GradebookAssessmentEditorMockup'
import { GradebookCategoryEditorMockup } from '@/app/__ui/GradebookCategoryEditorMockup'
import type { GradebookAssessmentColumn, GradebookCategory } from '@/types'
import { TooltipProvider } from '@/ui'

const categories: GradebookCategory[] = [
  { id: 'term', name: 'Term', percentage: 65, default_assessment_weight: 10, position: 0, is_default: true },
  { id: 'final', name: 'Final', percentage: 35, default_assessment_weight: 10, position: 1, is_default: false },
]

const assessment: GradebookAssessmentColumn = {
  assessment_id: 'ecosystems',
  assessment_type: 'assignment',
  code: 'A1',
  title: 'Ecosystems',
  possible: 20,
  weight: 10,
  include_in_final: true,
  category_id: 'term',
}

describe('Gradebook editor mockup accessibility', () => {
  it('calculates the read-only course weight from every supplied assessment', () => {
    const allAssessments = Array.from({ length: 12 }, (_, index) => index === 0 ? assessment : {
      ...assessment,
      assessment_id: `item-${index}`,
      title: `Assessment ${index}`,
    })
    render(<TooltipProvider>
      <GradebookAssessmentEditorMockup
        isOpen assessment={assessment} assessments={allAssessments} categories={categories}
        onClose={() => undefined} onSave={() => undefined}
      />
    </TooltipProvider>)
    const courseWeight = screen.getByRole('textbox', { name: 'Course weight' })
    expect(courseWeight).toHaveAttribute('readonly')
    expect(courseWeight).toHaveValue('5.42%')
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Category weight' }), { target: { value: '20' } })
    expect(courseWeight).toHaveValue('10%')
    fireEvent.change(screen.getByRole('textbox', { name: 'Assessment title' }), { target: { value: 'Assessment 11' } })
    expect(screen.getByRole('button', { name: 'Save assessment' })).toBeDisabled()
  })

  it('allocates a fresh category ID after a delete and reopen', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<TooltipProvider>
      <GradebookCategoryEditorMockup
        isOpen
        categories={[categories[0], { ...categories[1], id: 'pattern-category-3' }]}
        onClose={() => undefined}
        onSave={onSave}
      />
    </TooltipProvider>)
    await user.click(screen.getByRole('button', { name: 'Add category' }))
    await user.type(screen.getByRole('textbox', { name: 'Category name for Category 3' }), 'Participation')
    await user.click(screen.getByRole('button', { name: 'Save categories' }))
    const saved = onSave.mock.calls[0][0] as GradebookCategory[]
    expect(new Set(saved.map((category) => category.id)).size).toBe(3)
    expect(saved.map((category) => category.name)).toEqual(['Term', 'Final', 'Participation'])
    expect(saved[2].default_assessment_weight).toBe(10)
  })

  it('preserves an assessment weight when its category changes and blocks invalid weights', async () => {
    const user = userEvent.setup()
    render(<TooltipProvider>
      <GradebookAssessmentEditorMockup
        isOpen
        assessment={{ ...assessment, weight: 20 }}
        assessments={[assessment]}
        categories={categories}
        onClose={() => undefined}
        onSave={() => undefined}
      />
    </TooltipProvider>)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'final')
    const weight = screen.getByRole('spinbutton', { name: 'Category weight' })
    expect(weight).toHaveValue(20)
    await user.clear(weight)
    await user.type(weight, '1.5')
    expect(weight).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Save assessment' })).toBeDisabled()
  })

  it('names assessment fields, exposes calculated weight as read-only, and returns focus on Escape', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [open, setOpen] = useState(false)
      return <>
        <button onClick={() => setOpen(true)}>Open assessment</button>
        <GradebookAssessmentEditorMockup
          isOpen={open}
          assessment={assessment}
          assessments={[assessment]}
          categories={categories}
          onClose={() => setOpen(false)}
          onSave={() => undefined}
        />
      </>
    }
    render(<TooltipProvider><Harness /></TooltipProvider>)

    const trigger = screen.getByRole('button', { name: 'Open assessment' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Edit assessment' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('textbox', { name: 'Assessment title' })).toHaveValue('Ecosystems')
    expect(screen.getByRole('spinbutton', { name: 'Category weight' })).toHaveValue(10)
    const courseWeight = screen.getByRole('textbox', { name: 'Course weight' })
    expect(courseWeight).toHaveAttribute('readonly')
    expect(courseWeight).toHaveValue('65%')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), '')
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveDisplayValue('None')
    expect(courseWeight).toHaveValue('Not counted')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('exposes category defaults and locks semantically and supports keyboard activation', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<TooltipProvider>
      <GradebookCategoryEditorMockup
        isOpen
        categories={categories}
        onClose={() => undefined}
        onSave={onSave}
      />
    </TooltipProvider>)

    expect(screen.getByRole('dialog', { name: 'Edit categories' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Drag to reorder Term' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Term is the default category' })).toHaveAttribute('aria-pressed', 'true')
    const lock = screen.getByRole('button', { name: 'Lock Term course percentage' })
    lock.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Unlock Term course percentage' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('spinbutton', { name: 'Course percentage for Term' })).toBeDisabled()
    screen.getByRole('button', { name: 'Make Final the default category' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Final is the default category' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Make Term the default category' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: 'Save categories' }))
    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'term', is_default: false }),
      expect.objectContaining({ id: 'final', is_default: true }),
    ])
  })
})
