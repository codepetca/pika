import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssignmentSubmissionRequirementsEditor } from '@/components/AssignmentSubmissionRequirementsEditor'

describe('AssignmentSubmissionRequirementsEditor', () => {
  it.each(['retire', 'disable', 'unmount'] as const)('releases an activated real keyboard sensor on %s', async (transition) => {
    const onChange = vi.fn()
    const requirements = ['First', 'Second'].map((label, position) => ({ id: label, type: 'link' as const, label, instructions: '', required: true, position, validation_policy_json: {} }))
    const owner = render(<AssignmentSubmissionRequirementsEditor requirements={requirements} onChange={onChange} />)
    const handle = screen.getByRole('button', { name: 'Drag to reorder First' })
    fireEvent.keyDown(handle, { key: ' ', code: 'Space' })
    await waitFor(() => expect(handle).toHaveAttribute('aria-pressed', 'true'))
    const activeArrow = new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true })
    act(() => { document.dispatchEvent(activeArrow) })
    expect(activeArrow.defaultPrevented).toBe(true)
    if (transition === 'unmount') owner.unmount()
    else owner.rerender(<AssignmentSubmissionRequirementsEditor requirements={requirements} onChange={onChange} interactionActive={transition !== 'retire'} disabled={transition === 'disable'} />)
    const retiredArrow = new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true })
    act(() => { document.dispatchEvent(retiredArrow) })
    expect(retiredArrow.defaultPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('retires its saved Remove confirmation and add menu while preserving requirement labels and styling', () => {
    const onChange = vi.fn()
    const requirements = [{ id: 'saved-retired-link', type: 'link' as const, label: 'Saved link', instructions: '', required: true, position: 0, validation_policy_json: {} }]
    const { rerender } = render(<AssignmentSubmissionRequirementsEditor requirements={requirements} onChange={onChange} />)
    const originalInput = screen.getByRole('textbox', { name: 'Link label' })
    const originalClass = originalInput.className
    fireEvent.click(screen.getByRole('button', { name: 'Remove attachment' }))
    expect(screen.getByRole('dialog', { name: 'Remove attachment?' })).toBeInTheDocument()
    rerender(<AssignmentSubmissionRequirementsEditor requirements={requirements} onChange={onChange} interactionActive={false} />)
    expect(screen.queryByRole('dialog', { name: 'Remove attachment?' })).not.toBeInTheDocument()
    const passiveInput = screen.getByRole('textbox', { name: 'Link label' })
    expect(passiveInput).toHaveValue('Saved link')
    expect(passiveInput.className).toBe(originalClass)
    expect(passiveInput).toBeEnabled()
    fireEvent.change(passiveInput, { target: { value: 'Stale changed label' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add submission requirement' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove attachment' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Remove attachment?' })).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

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
