import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EllipsisVertical, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  TeacherWorkSurfaceActionCluster,
  TeacherWorkSurfaceIconButton,
  TeacherWorkSurfaceIconMenuButton,
  TeacherWorkSurfaceMenuButton,
} from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import { ModalLayer, TooltipProvider } from '@/ui'

describe('TeacherWorkSurfaceActionCluster', () => {
  it('separates primary chooser actions from direct contextual toggles', () => {
    const addAssignment = vi.fn()
    const toggleControls = vi.fn()

    render(
      <TeacherWorkSurfaceActionCluster>
        <TeacherWorkSurfaceMenuButton
          label={(
            <span>
              <Plus aria-hidden="true" />
              New Classwork
            </span>
          )}
          menuAriaLabel="New classwork"
          items={[
            {
              id: 'assignment',
              label: 'Assignment',
              onSelect: addAssignment,
            },
          ]}
        />
        <TeacherWorkSurfaceIconButton
          ariaLabel="Organize classwork"
          icon={<Pencil aria-hidden="true" />}
          pressed
          onClick={toggleControls}
        />
      </TeacherWorkSurfaceActionCluster>,
    )

    const menuTrigger = screen.getByRole('button', { name: 'New Classwork' })
    expect(menuTrigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(menuTrigger)
    const menu = screen.getByRole('menu', { name: 'New classwork' })
    const expandedMenuTrigger = screen.getByRole('button', { name: 'New Classwork' })
    expect(menu).toBeInTheDocument()
    expect(expandedMenuTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(expandedMenuTrigger).toHaveAttribute('aria-controls', menu.id)
    const assignmentMenuItem = screen.getByRole('menuitem', { name: 'Assignment' })
    expect(assignmentMenuItem).toHaveClass(
      'min-h-control',
      'focus-visible:ring-foundation',
      'focus-visible:ring-focus',
      'focus-visible:ring-inset',
    )
    expect(screen.queryByText('Work students complete')).not.toBeInTheDocument()
    fireEvent.click(assignmentMenuItem)
    expect(addAssignment).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'New Classwork' })).toHaveFocus()

    expect(screen.getByRole('button', { name: 'Organize classwork' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Reorder or delete items')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Organize classwork' }))
    expect(toggleControls).toHaveBeenCalledTimes(1)
  })

  it('supports radio-style checked menu items for mutually exclusive options', () => {
    const onHoverChange = vi.fn()

    render(
      <TeacherWorkSurfaceMenuButton
        label="Display"
        menuAriaLabel="Display options"
        items={[
          {
            id: 'percent',
            label: 'Show %',
            checked: true,
            checkedRole: 'menuitemradio',
            onSelect: vi.fn(),
          },
          {
            id: 'raw',
            label: 'Show Raw',
            checked: false,
            checkedRole: 'menuitemradio',
            onSelect: vi.fn(),
          },
          {
            id: 'columns',
            label: 'Column controls',
            checked: false,
            onSelect: vi.fn(),
            onHoverChange,
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Display' }))

    expect(screen.getByRole('menuitemradio', { name: 'Show %' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Show Raw' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Column controls' })).toHaveAttribute('aria-checked', 'false')

    const columnControls = screen.getByRole('menuitemcheckbox', { name: 'Column controls' })
    fireEvent.mouseEnter(columnControls)
    fireEvent.mouseLeave(columnControls)
    fireEvent.focus(columnControls)
    fireEvent.blur(columnControls)
    expect(onHoverChange.mock.calls).toEqual([[true], [false], [true], [false]])

    expect(screen.getByRole('menuitemradio', { name: 'Show %' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitemradio', { name: 'Show Raw' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'End' })
    expect(screen.getByRole('menuitemcheckbox', { name: 'Column controls' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Home' })
    expect(screen.getByRole('menuitemradio', { name: 'Show %' })).toHaveFocus()
    const outerEscapeHandler = vi.fn()
    window.addEventListener('keydown', outerEscapeHandler)
    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(false)
    window.removeEventListener('keydown', outerEscapeHandler)

    expect(outerEscapeHandler).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Display' })).toHaveFocus()
  })

  it('keeps a tooltip-wrapped icon menu trigger mounted through a modal focus round trip', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [isDialogOpen, setIsDialogOpen] = useState(false)
      return (
        <TooltipProvider>
          <TeacherWorkSurfaceIconMenuButton
            ariaLabel="More actions"
            tooltip="More actions"
            icon={<EllipsisVertical aria-hidden="true" />}
            items={[{ id: 'edit', label: 'Edit', onSelect: () => setIsDialogOpen(true) }]}
          />
          <ModalLayer
            isOpen={isDialogOpen}
            onClose={() => setIsDialogOpen(false)}
            ariaLabel="Edit item"
          >
            <button type="button" onClick={() => setIsDialogOpen(false)}>Close</button>
          </ModalLayer>
        </TooltipProvider>
      )
    }

    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'More actions' })
    expect(trigger).toHaveClass('border-transparent', 'bg-transparent', 'text-text-muted')
    await user.hover(trigger)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('More actions')
    await user.click(trigger)

    expect(screen.getByRole('button', { name: 'More actions' })).toBe(trigger)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    await user.click(await screen.findByRole('button', { name: 'Close' }))
    await waitFor(() => expect(trigger).toHaveFocus())
    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    })
    expect(document.querySelector('[data-radix-popper-content-wrapper] [role="tooltip"]')).toBeNull()
  })
})
