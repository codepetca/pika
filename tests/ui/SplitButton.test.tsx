import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SplitButton } from '@/ui'

describe('SplitButton', () => {
  it('runs primary action when main button is clicked', () => {
    const onPrimaryClick = vi.fn()
    const onSelectDraft = vi.fn()

    render(
      <SplitButton
        label="Post"
        onPrimaryClick={onPrimaryClick}
        options={[
          { id: 'draft', label: 'Draft', onSelect: onSelectDraft },
        ]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    expect(onPrimaryClick).toHaveBeenCalledOnce()
    expect(onSelectDraft).not.toHaveBeenCalled()
  })

  it('opens menu and runs selected option action', () => {
    const onPrimaryClick = vi.fn()
    const onSelectSchedule = vi.fn()

    render(
      <SplitButton
        label="Post"
        onPrimaryClick={onPrimaryClick}
        options={[
          { id: 'schedule', label: 'Schedule', onSelect: onSelectSchedule },
        ]}
        toggleAriaLabel="Choose action"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Choose action' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule' }))

    expect(onSelectSchedule).toHaveBeenCalledOnce()
    expect(onPrimaryClick).not.toHaveBeenCalled()
    expect(screen.queryByRole('menuitem', { name: 'Schedule' })).not.toBeInTheDocument()
  })

  it('renders dropdown below when menuPlacement is down', () => {
    render(
      <SplitButton
        label="Post"
        onPrimaryClick={vi.fn()}
        options={[
          { id: 'schedule', label: 'Schedule', onSelect: vi.fn() },
        ]}
        toggleAriaLabel="Choose action"
        menuPlacement="down"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Choose action' }))
    const menu = screen.getByRole('menu')
    expect(menu.className).toContain('top-full')
    expect(menu.className).not.toContain('bottom-full')
  })

  it('notifies option hover state and clears it when selected', () => {
    const onHoverChange = vi.fn()

    render(
      <SplitButton
        label="Post"
        onPrimaryClick={vi.fn()}
        options={[
          { id: 'schedule', label: 'Schedule', onSelect: vi.fn(), onHoverChange },
        ]}
        toggleAriaLabel="Choose action"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Choose action' }))
    const option = screen.getByRole('menuitem', { name: 'Schedule' })

    fireEvent.mouseEnter(option)
    expect(onHoverChange).toHaveBeenLastCalledWith(true)

    fireEvent.click(option)
    expect(onHoverChange).toHaveBeenLastCalledWith(false)
  })
})
