import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EllipsisVertical, Pencil, Plus, Code2, Copy, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { renderToString } from 'react-dom/server'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TeacherWorkSurfaceActionCluster,
  TeacherWorkSurfaceIconButton,
  TeacherWorkSurfaceIconMenuButton,
  TeacherWorkSurfaceMenuButton,
} from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import { ModalLayer, TooltipProvider } from '@/ui'

describe('TeacherWorkSurfaceActionCluster', () => {
  it('attaches closed-menu relationships only after hydration and preserves unique keyboard owners', () => {
    const menus = <>
      <TeacherWorkSurfaceMenuButton label="First actions" items={[{ id: 'first', label: 'First item', onSelect: vi.fn() }]} />
      <TeacherWorkSurfaceMenuButton label="Second actions" items={[{ id: 'second', label: 'Second item', onSelect: vi.fn() }]} />
    </>
    const server = document.createElement('div')
    server.innerHTML = renderToString(menus)
    for (const trigger of server.querySelectorAll('button')) {
      expect(trigger).not.toHaveAttribute('id')
      expect(trigger).not.toHaveAttribute('aria-controls')
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
    }
    render(menus)
    const first = screen.getByRole('button', { name: 'First actions' })
    const second = screen.getByRole('button', { name: 'Second actions' })
    expect(first.id).not.toBe('')
    expect(second.id).not.toBe(first.id)
    fireEvent.keyDown(second, { key: 'ArrowDown' })
    const menu = screen.getByRole('menu')
    expect(second).toHaveAttribute('aria-controls', menu.id)
    expect(menu).toHaveAttribute('aria-labelledby', second.id)
    expect(screen.getByRole('menuitem', { name: 'Second item' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(second).toHaveFocus()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

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

    expect(columnControls).toHaveFocus()
    expect(columnControls).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(columnControls, { key: 'Home' })
    expect(screen.getByRole('menuitemradio', { name: 'Show %' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitemradio', { name: 'Show Raw' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(screen.getByRole('menuitemcheckbox', { name: 'Column controls' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(screen.getByRole('menuitemradio', { name: 'Show %' })).toHaveFocus()
    const outerEscapeHandler = vi.fn()
    window.addEventListener('keydown', outerEscapeHandler)
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Escape' })).toBe(false)
    window.removeEventListener('keydown', outerEscapeHandler)

    expect(outerEscapeHandler).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Display' })).toHaveFocus()
  })

  it.each(['keyboard', 'pointer'] as const)('clears the %s preview when the menu is dismissed', (input) => {
    const onHoverChange = vi.fn()
    render(
      <TeacherWorkSurfaceMenuButton
        label="Student actions"
        items={[{ id: 'copy', label: 'Copy grade', onSelect: vi.fn(), onHoverChange }]}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Student actions' })
    fireEvent.click(trigger)
    const item = screen.getByRole('menuitem', { name: 'Copy grade' })
    if (input === 'pointer') fireEvent.mouseEnter(item)
    expect(onHoverChange).toHaveBeenLastCalledWith(true)
    fireEvent.keyDown(item, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(onHoverChange).toHaveBeenLastCalledWith(false)
  })

  it('uses the current preview callback when items rerender before dismissal', () => {
    const onHoverChange = vi.fn()

    function Harness({ version }: { version: number }) {
      return (
        <TeacherWorkSurfaceMenuButton
          label="Student actions"
          items={[{
            id: 'copy',
            label: 'Copy grade',
            onSelect: vi.fn(),
            onHoverChange: (active) => onHoverChange(version, active),
          }]}
        />
      )
    }

    const { rerender } = render(<Harness version={1} />)
    const trigger = screen.getByRole('button', { name: 'Student actions' })
    fireEvent.click(trigger)
    const item = screen.getByRole('menuitem', { name: 'Copy grade' })
    expect(onHoverChange).toHaveBeenLastCalledWith(1, true)

    rerender(<Harness version={2} />)
    fireEvent.keyDown(item, { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(onHoverChange).toHaveBeenLastCalledWith(2, false)
    expect(onHoverChange).not.toHaveBeenCalledWith(1, false)
  })

  it('clears an active preview when its rerendered item removes the preview callback', () => {
    const onHoverChange = vi.fn()

    function Harness({ previewEnabled }: { previewEnabled: boolean }) {
      return (
        <TeacherWorkSurfaceMenuButton
          label="Student actions"
          items={[{
            id: 'copy',
            label: 'Copy grade',
            onSelect: vi.fn(),
            onHoverChange: previewEnabled ? onHoverChange : undefined,
          }]}
        />
      )
    }

    const { rerender } = render(<Harness previewEnabled />)
    const trigger = screen.getByRole('button', { name: 'Student actions' })
    fireEvent.click(trigger)
    expect(onHoverChange).toHaveBeenLastCalledWith(true)

    rerender(<Harness previewEnabled={false} />)
    expect(onHoverChange).toHaveBeenLastCalledWith(false)

    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Copy grade' }), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(onHoverChange.mock.calls).toEqual([[true], [false]])
  })

  it('uses one roving menu tab stop, skips disabled items, and closes on Tab', async () => {
    const user = userEvent.setup()
    render(
      <TeacherWorkSurfaceMenuButton
        label="Classroom settings"
        items={[
          { id: 'reuse', label: 'Reuse', onSelect: vi.fn() },
          { id: 'unarchive', label: 'Unarchive', onSelect: vi.fn() },
          { id: 'delete', label: 'Delete', disabled: true, destructive: true, onSelect: vi.fn() },
        ]}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Classroom settings' })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    const reuse = screen.getByRole('menuitem', { name: 'Reuse' })
    const unarchive = screen.getByRole('menuitem', { name: 'Unarchive' })
    const deleteItem = screen.getByRole('menuitem', { name: 'Delete' })
    expect(reuse).toHaveAttribute('tabindex', '0')
    expect(unarchive).toHaveAttribute('tabindex', '-1')
    expect(deleteItem).toHaveAttribute('tabindex', '-1')

    await user.keyboard('{ArrowDown}')
    expect(unarchive).toHaveFocus()
    expect(unarchive).toHaveAttribute('tabindex', '0')
    expect(reuse).toHaveAttribute('tabindex', '-1')
    await user.keyboard('{ArrowDown}')
    expect(reuse).toHaveFocus()
    await user.keyboard('{End}')
    expect(unarchive).toHaveFocus()
    await user.keyboard('{Home}')
    expect(reuse).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    await user.keyboard('{Tab}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
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


describe('TeacherWorkSurface menu lifetime', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
  function motion(reduced = false) {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList)
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ getPropertyValue: () => '100ms' } as unknown as CSSStyleDeclaration)
  }
  function clickHandler(node: HTMLElement) {
    const key = Object.keys(node).find((name) => name.startsWith('__reactProps$'))!
    return (node as unknown as Record<string, { onClick: (event: { stopPropagation: () => void }) => void }>)[key].onClick
  }
  function items(onSelect = vi.fn()) {
    return [{ id: 'add', label: 'Add', icon: <Plus className="h-4 w-4" aria-hidden="true" />, onSelect }]
  }
  function open() { fireEvent.click(screen.getByRole('button', { name: 'Actions' })) }
  function escape() { fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Add' }), { key: 'Escape' }) }

  it('retires captured commands and renders only static known-icon opacity presentation', () => {
    motion(); vi.useFakeTimers()
    const command = vi.fn()
    const view = render(<TeacherWorkSurfaceMenuButton label="Actions" items={items(command)} exitMotion="opacity" />)
    open(); const oldClick = clickHandler(screen.getByRole('menuitem', { name: 'Add' })); escape()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    const closing = view.container.querySelector('[data-menu-closing]') as HTMLElement
    expect(closing).toHaveAttribute('aria-hidden', 'true')
    expect(closing.inert).toBe(true)
    expect(closing.querySelectorAll('button,[tabindex],[role]')).toHaveLength(0)
    expect(closing.querySelector('.lucide-plus')).toBeInTheDocument()
    act(() => oldClick({ stopPropagation() {} }))
    expect(command).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(100))
    expect(closing).not.toBeInTheDocument()
  })

  it.each([Plus, Code2, Copy, Trash2])('accepts each audited icon with controlled props', (Icon) => {
    motion()
    const view = render(<TeacherWorkSurfaceMenuButton label="Actions" items={[{ id: 'add', label: 'Add', icon: <Icon className="h-4 w-4" aria-hidden="true" />, onSelect: vi.fn() }]} exitMotion="opacity" />)
    open(); escape()
    expect(view.container.querySelector('[data-menu-closing] svg')).toBeInTheDocument()
  })

  it.each(['default', 'reduced', 'customLabel', 'customIcon', 'unsupportedProps'] as const)('closes immediately for %s', (reason) => {
    motion(reason === 'reduced')
    const entry = items()[0]
    if (reason === 'customLabel') entry.label = <span>Add</span> as unknown as string
    if (reason === 'customIcon') entry.icon = <Pencil />
    if (reason === 'unsupportedProps') entry.icon = <Plus className="h-4 w-4" aria-hidden="true" onClick={vi.fn()} />
    const view = render(<TeacherWorkSurfaceMenuButton label="Actions" items={[entry]} exitMotion={reason === 'default' ? undefined : 'opacity'} />)
    open(); escape()
    expect(view.container.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
  })

  it('dispatches current same-ID commands and preview cleanup after a rerender', () => {
    const oldCommand = vi.fn(); const newCommand = vi.fn(); const oldPreview = vi.fn(); const newPreview = vi.fn()
    const view = render(<TeacherWorkSurfaceMenuButton label="Actions" items={[{ ...items(oldCommand)[0], onHoverChange: oldPreview }]} />)
    open(); const queuedClick = clickHandler(screen.getByRole('menuitem', { name: 'Add' }))
    view.rerender(<TeacherWorkSurfaceMenuButton label="Actions" items={[{ ...items(newCommand)[0], onHoverChange: newPreview }]} />)
    act(() => queuedClick({ stopPropagation() {} }))
    expect(oldCommand).not.toHaveBeenCalled(); expect(newCommand).toHaveBeenCalledOnce()
    expect(newPreview).toHaveBeenLastCalledWith(false)
    expect(oldPreview).not.toHaveBeenCalledWith(false)
  })

  it.each(['disabled', 'inactive', 'empty', 'unmount'] as const)('fences queued events across %s', (reason) => {
    const command = vi.fn(); const input = items(command)
    const view = render(<TeacherWorkSurfaceMenuButton label="Actions" items={input} />)
    open(); const queuedClick = clickHandler(screen.getByRole('menuitem', { name: 'Add' }))
    if (reason === 'unmount') view.unmount()
    else view.rerender(<TeacherWorkSurfaceMenuButton label="Actions" items={reason === 'empty' ? [] : input} disabled={reason === 'disabled'} interactionActive={reason !== 'inactive'} />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    act(() => queuedClick({ stopPropagation() {} }))
    expect(command).not.toHaveBeenCalled()
  })

  it('retires fading presentation on availability changes and cancels old expiry on rapid reopen', () => {
    motion(); vi.useFakeTimers()
    const command = vi.fn(); const input = items(command)
    const view = render(<TeacherWorkSurfaceMenuButton label="Actions" items={input} exitMotion="opacity" />)
    open(); const queuedClick = clickHandler(screen.getByRole('menuitem', { name: 'Add' })); escape()
    expect(view.container.querySelector('[data-menu-closing]')).toBeInTheDocument()
    open()
    act(() => { queuedClick({ stopPropagation() {} }); vi.advanceTimersByTime(100) })
    expect(command).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    escape()
    view.rerender(<TeacherWorkSurfaceMenuButton label="Actions" items={input} exitMotion="opacity" interactionActive={false} />)
    expect(view.container.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
    view.rerender(<TeacherWorkSurfaceMenuButton label="Actions" items={input} exitMotion="opacity" />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('rejects a queued command after its same-ID item becomes disabled', () => {
    const command = vi.fn(); const input = items(command)
    const view = render(<TeacherWorkSurfaceMenuButton label="Actions" items={input} />)
    open(); const queuedClick = clickHandler(screen.getByRole('menuitem', { name: 'Add' }))
    view.rerender(<TeacherWorkSurfaceMenuButton label="Actions" items={[{ ...input[0], disabled: true }]} />)
    act(() => queuedClick({ stopPropagation() {} }))
    expect(command).not.toHaveBeenCalled()
  })


  it('copies the live normal/destructive ordering and grouping into presentation', () => {
    motion()
    const input = [
      { id: 'remove', label: 'Remove', destructive: true, onSelect: vi.fn() },
      { id: 'add', label: 'Add', onSelect: vi.fn() },
      { id: 'copy', label: 'Copy', dividerBefore: true, onSelect: vi.fn() },
    ]
    const view = render(<TeacherWorkSurfaceMenuButton label="Actions" items={input} exitMotion="opacity" />)
    open()
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Add', 'Copy', 'Remove'])
    escape()
    const closing = view.container.querySelector('[data-menu-closing]')!
    expect(Array.from(closing.querySelectorAll('.font-medium')).map((item) => item.textContent)).toEqual(['Add', 'Copy', 'Remove'])
    expect(closing.querySelectorAll('.border-t')).toHaveLength(2)
  })

  it('retires an opacity owner when every command becomes disabled', () => {
    motion()
    const input = items()
    const view = render(<TeacherWorkSurfaceMenuButton label="Actions" items={input} exitMotion="opacity" />)
    open(); escape()
    expect(view.container.querySelector('[data-menu-closing]')).toBeInTheDocument()
    view.rerender(<TeacherWorkSurfaceMenuButton label="Actions" items={[{ ...input[0], disabled: true }]} exitMotion="opacity" />)
    expect(view.container.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actions' })).toBeDisabled()
  })

})
