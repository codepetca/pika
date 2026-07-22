import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { TestDocumentsEditor } from '@/components/TestDocumentsEditor'

describe('TestDocumentsEditor', () => {
  afterEach(() => {
    cleanup()
  })

  it('exposes document types as keyboard-navigable tabs without adding a panel tab stop', async () => {
    const user = userEvent.setup()
    render(<TestDocumentsEditor testId="test-1" isEditable />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Document' }))

    const linkTab = screen.getByRole('tab', { name: 'Link' })
    expect(linkTab).toHaveAttribute('aria-selected', 'true')
    expect(linkTab).toHaveAttribute('tabindex', '0')

    linkTab.focus()
    fireEvent.keyDown(linkTab, { key: 'End' })

    const textTab = screen.getByRole('tab', { name: 'Text' })
    expect(textTab).toHaveFocus()
    expect(textTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Text' })).not.toHaveAttribute('tabindex')

    await user.tab()
    expect(screen.getByRole('textbox', { name: 'Document title' })).toHaveFocus()
  })
})
