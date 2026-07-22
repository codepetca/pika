import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TabPanel, Tabs } from '@/ui'

describe('Tabs', () => {
  it('owns tab relationships, roving focus, and a 44px target', () => {
    render(
      <>
        <Tabs
          ariaLabel="Workspace modes"
          items={[
            { value: 'class', label: 'Class' },
            { value: 'disabled', label: 'Disabled', disabled: true },
            { value: 'individual', label: 'Individual' },
          ]}
          value="class"
          onValueChange={vi.fn()}
          getTabId={(value) => `${value}-tab`}
          getPanelId={(value) => `${value}-panel`}
        />
        <TabPanel id="class-panel" labelledBy="class-tab">
          Class content
        </TabPanel>
      </>,
    )

    const activeTab = screen.getByRole('tab', { name: 'Class' })
    const inactiveTab = screen.getByRole('tab', { name: 'Individual' })
    const panel = screen.getByRole('tabpanel', { name: 'Class' })

    const tabList = screen.getByRole('tablist', { name: 'Workspace modes' })
    expect(tabList).toHaveAttribute(
      'aria-orientation',
      'horizontal',
    )
    expect(tabList).toHaveClass('min-w-0', 'max-w-full', 'overflow-x-auto')
    expect(activeTab).toHaveAttribute('aria-selected', 'true')
    expect(activeTab).toHaveAttribute('aria-controls', 'class-panel')
    expect(activeTab).toHaveAttribute('tabindex', '0')
    expect(activeTab).toHaveClass('min-h-11', 'shrink-0', 'focus-visible:ring-2')
    expect(inactiveTab).toHaveAttribute('tabindex', '-1')
    expect(panel).toHaveAttribute('aria-labelledby', 'class-tab')
    expect(panel).not.toHaveAttribute('tabindex')
  })

  it('uses arrows, Home, and End to activate enabled tabs', () => {
    const onValueChange = vi.fn()
    render(
      <Tabs
        ariaLabel="Document type"
        items={[
          { value: 'link', label: 'Link' },
          { value: 'upload', label: 'PDF', disabled: true },
          { value: 'text', label: 'Text' },
        ]}
        value="link"
        onValueChange={onValueChange}
      />,
    )

    const link = screen.getByRole('tab', { name: 'Link' })
    const text = screen.getByRole('tab', { name: 'Text' })

    fireEvent.keyDown(link, { key: 'ArrowRight' })
    expect(onValueChange).toHaveBeenLastCalledWith('text')
    expect(text).toHaveFocus()

    fireEvent.keyDown(text, { key: 'ArrowRight' })
    expect(onValueChange).toHaveBeenLastCalledWith('link')
    expect(link).toHaveFocus()

    fireEvent.keyDown(link, { key: 'End' })
    expect(onValueChange).toHaveBeenLastCalledWith('text')

    fireEvent.keyDown(text, { key: 'Home' })
    expect(onValueChange).toHaveBeenLastCalledWith('link')
  })
})
