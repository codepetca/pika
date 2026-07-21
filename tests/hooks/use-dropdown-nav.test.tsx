import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useDropdownNav } from '@/hooks/use-dropdown-nav'

function MenuHarness() {
  const menu = useDropdownNav({
    itemCount: 3,
    isItemDisabled: (index) => index === 1,
  })

  return (
    <div ref={menu.containerRef}>
      <button
        id={menu.triggerId}
        ref={menu.triggerRef}
        type="button"
        aria-controls={menu.menuId}
        aria-expanded={menu.isOpen}
        aria-haspopup="menu"
        onClick={menu.handleTriggerClick}
        onKeyDown={menu.handleTriggerKeyDown}
      >
        Actions
      </button>
      {menu.isOpen ? (
        <div id={menu.menuId} role="menu" aria-labelledby={menu.triggerId}>
          {['First', 'Disabled', 'Last'].map((label, index) => (
            <button
              key={label}
              id={menu.getItemId(index)}
              ref={(element) => {
                menu.itemRefs.current[index] = element
              }}
              type="button"
              role="menuitem"
              disabled={index === 1}
              tabIndex={menu.focusedIndex === index ? 0 : -1}
              onKeyDown={menu.handleItemKeyDown}
              onMouseEnter={() => menu.setFocusedIndex(index)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

describe('useDropdownNav', () => {
  it('opens with focus, skips disabled items, and supports Home and End', async () => {
    render(<MenuHarness />)

    const trigger = screen.getByRole('button', { name: 'Actions' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })

    const first = await screen.findByRole('menuitem', { name: 'First' })
    const last = screen.getByRole('menuitem', { name: 'Last' })
    await waitFor(() => expect(first).toHaveFocus())

    fireEvent.keyDown(first, { key: 'ArrowDown' })
    await waitFor(() => expect(last).toHaveFocus())

    fireEvent.keyDown(last, { key: 'Home' })
    await waitFor(() => expect(first).toHaveFocus())

    fireEvent.keyDown(first, { key: 'End' })
    await waitFor(() => expect(last).toHaveFocus())

    fireEvent.keyDown(last, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
