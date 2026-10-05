import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SurveyEditSplitPattern } from '@/app/__ui/SurveyEditSplitPattern'
import { TooltipProvider } from '@/ui'

vi.mock('@/components/editor', () => ({ MarkdownContentEditor: () => <div /> }))

function openPrototype() {
  render(<TooltipProvider><SurveyEditSplitPattern /></TooltipProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Open survey edit prototype' }))
  return within(screen.getByRole('dialog', { name: 'Edit Survey' }))
}

describe('SurveyEditSplitPattern', () => {
  it('carries keyboard option reordering from the shared editor into Markdown', () => {
    const editor = openPrototype()
    const first = (editor.getByRole('textbox', { name: 'Question 1 option A' }) as HTMLInputElement).value
    const second = (editor.getByRole('textbox', { name: 'Question 1 option B' }) as HTMLInputElement).value
    fireEvent.keyDown(editor.getByRole('button', { name: /Reorder option A;/ }), { key: 'ArrowDown' })
    expect(editor.getByRole('textbox', { name: 'Question 1 option A' })).toHaveValue(second)
    expect(editor.getByRole('textbox', { name: 'Question 1 option B' })).toHaveValue(first)
    fireEvent.click(editor.getByRole('button', { name: 'Markdown', exact: true }))
    const markdown = (editor.getByRole('textbox', { name: 'Survey markdown editor' }) as HTMLTextAreaElement).value
    expect(markdown.indexOf(second)).toBeLessThan(markdown.indexOf(first))
  })

  it('blocks simulated publishing without a title and resets the fixture on reopen', () => {
    const editor = openPrototype()
    fireEvent.change(editor.getByRole('textbox', { name: 'Title' }), { target: { value: '' } })
    expect(editor.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled()
    expect(editor.getByText('Add a title before publishing.')).toBeVisible()
    fireEvent.click(editor.getByRole('button', { name: 'Close survey edit prototype' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open survey edit prototype' }))
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Wetland field study feedback')
    expect(screen.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled()
  })

  it('keeps title and settings in one editing surface while Markdown is open', () => {
    const editor = openPrototype()
    fireEvent.click(editor.getByRole('button', { name: 'Markdown', exact: true }))
    expect(editor.getByRole('textbox', { name: 'Title' })).toBeDisabled()
    expect(editor.getByRole('button', { name: 'Settings', exact: true })).toBeDisabled()
    const markdown = editor.getByRole('textbox', { name: 'Survey markdown editor' }) as HTMLTextAreaElement
    fireEvent.change(markdown, { target: { value: markdown.value.replace('Title: Wetland field study feedback', 'Title: Updated title') } })
    fireEvent.click(editor.getByRole('button', { name: 'Apply Markdown' }))
    expect(editor.getByRole('textbox', { name: 'Title' })).toBeEnabled()
    expect(editor.getByRole('textbox', { name: 'Title' })).toHaveValue('Updated title')
    expect(editor.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled()
  })

  it('rejects a link question without replacing the authored survey', () => {
    const editor = openPrototype()
    fireEvent.click(editor.getByRole('button', { name: 'Markdown', exact: true }))
    fireEvent.change(editor.getByRole('textbox', { name: 'Survey markdown editor' }), { target: { value: '# Survey\nTitle: Replacement\n\n## Questions\n\n### Question 1\nType: link\nPrompt:\nShare a link\n\nMax Chars: 500\n' } })
    fireEvent.click(editor.getByRole('button', { name: 'Apply Markdown' }))
    expect(editor.getByRole('alert')).toHaveTextContent('This prototype supports multiple-choice and open-response questions.')
    expect(editor.getByRole('textbox', { name: 'Title' })).toHaveValue('Wetland field study feedback')
    expect(editor.getByText('3 total')).toBeVisible()
  })
})
