import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
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

    expect(screen.getByRole('dialog', { name: 'Edit gradebook' })).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: 'Save gradebook' }))
    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'term', is_default: false }),
      expect.objectContaining({ id: 'final', is_default: true }),
    ])
  })
})
