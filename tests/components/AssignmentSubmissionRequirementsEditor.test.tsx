import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssignmentSubmissionRequirementsEditor } from '@/components/AssignmentSubmissionRequirementsEditor'

describe('AssignmentSubmissionRequirementsEditor', () => {
  it('opens one named add menu and emits the selected requirement type', () => {
    const onChange = vi.fn()
    render(<AssignmentSubmissionRequirementsEditor requirements={[]} onChange={onChange} />)

    const group = screen.getByRole('group', { name: 'Submission Requirement' })
    const addRequirement = within(group).getByRole('button', { name: 'Add submission requirement' })
    expect(within(group).getAllByRole('button')).toEqual([addRequirement])

    fireEvent.click(addRequirement)
    expect(screen.getByRole('menuitem', { name: 'Link' })).toHaveFocus()
    expect(screen.getByRole('menuitem', { name: 'Repo' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Image' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Repo' }))
    expect(onChange).toHaveBeenCalledWith([{
      type: 'repo_link',
      label: 'Repo link',
      instructions: '',
      required: true,
      position: 0,
      validation_policy_json: {},
    }])
  })
})
