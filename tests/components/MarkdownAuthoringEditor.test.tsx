import { useState } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { MarkdownAuthoringEditor } from '@/components/editor/MarkdownAuthoringEditor'
import { CreationModalShell } from '@/components/creation/CreationModalShell'
import { MarkdownAuthoringPattern } from '@/app/__ui/MarkdownAuthoringPattern'

const original = '# Instructions\n\nExplain **why**.\n\n- First\n- Second\n'

function Harness({ onChange = vi.fn(), disabled = false, interactionActive = true }) {
  const [markdown, setMarkdown] = useState(original)
  const [mode, setMode] = useState<'visual' | 'markdown'>('visual')
  return <MarkdownAuthoringEditor label="Instructions" markdown={markdown}
    mode={mode} onModeChange={setMode} disabled={disabled} interactionActive={interactionActive}
    onMarkdownChange={(value) => { setMarkdown(value); onChange(value) }} />
}

describe('MarkdownAuthoringEditor', () => {
  it('lets Tab leave toolbar controls for the editor and Shift+Tab return to mode selection', async () => {
    const user = userEvent.setup()
    render(<CreationModalShell isOpen title="Edit instructions" titleId="compact-instructions" closeLabel="Close instructions" onClose={vi.fn()}><Harness /></CreationModalShell>)
    const editor = await screen.findByRole('textbox', { name: 'Instructions' })
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting options' })
    const write = screen.getByRole('button', { name: 'Write' })
    write.focus()
    await user.tab()
    expect(toolbar).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(within(toolbar).getByRole('button', { name: 'Bold' })).toHaveFocus()
    await user.tab()
    expect(editor).toHaveFocus()
    toolbar.focus()
    await user.tab({ shift: true })
    expect(write).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Close instructions' })).toHaveFocus()
  })

  it('keeps the Pattern Lab student reference readable without teacher editing controls', () => {
    render(<MarkdownAuthoringPattern role="student" />)
    expect(screen.getByRole('heading', { name: 'Field observations', exact: true })).toBeInTheDocument()
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /editing mode/ })).not.toBeInTheDocument()
  })

  it('switches with keyboard focus and preserves literal Markdown until an actual edit', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const write = screen.getByRole('button', { name: 'Write', pressed: true })
    write.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('button', { name: 'Markdown', pressed: true })).toHaveFocus()
    const source = screen.getByRole('textbox', { name: 'Instructions Markdown' })
    expect(source).toHaveValue(original)
    expect(onChange).not.toHaveBeenCalled()
    const next = '## From AI\n\n> Keep **this**.\n\n```\nx = 1\n```\n'
    fireEvent.change(source, { target: { value: next } })
    await user.click(write)
    expect(await screen.findByRole('textbox', { name: 'Instructions' })).toHaveTextContent('From AI')
    await user.click(screen.getByRole('button', { name: 'Markdown' }))
    expect(screen.getByRole('textbox', { name: 'Instructions Markdown' })).toHaveValue(next)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(next)
  })

  it('exposes five toolbar controls and saves formatting from the keyboard-operated Format menu', async () => {
    // Exercise markdown-format-menu through its real editor selection and toolbar.
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const editor = await screen.findByRole('textbox', { name: 'Instructions' }) as HTMLElement & { editor: Editor }
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting options' })
    expect(within(toolbar).getAllByRole('button')).toHaveLength(5)
    expect(within(toolbar).getByRole('button', { name: 'Format' })).toBeInTheDocument()
    expect(within(toolbar).queryByRole('button', { name: 'Underline' })).not.toBeInTheDocument()
    act(() => { editor.editor.commands.setTextSelection(1) })
    const format = within(toolbar).getByRole('button', { name: 'Format' })
    format.focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Heading 2' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Bullet list' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Code block' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(format).toHaveFocus()
    await user.click(format)
    await user.click(screen.getByRole('menuitem', { name: 'Heading 2' }))
    expect(onChange.mock.lastCall?.[0]).toMatch(/^## Instructions/)
    await user.click(screen.getByRole('button', { name: 'Markdown' }))
    expect(screen.getByRole('textbox', { name: 'Instructions Markdown' })).toHaveValue(onChange.mock.lastCall?.[0])
  })

  it('retires source editing, mode changes and blur callbacks while retaining the draft', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onBlur = vi.fn()
    const props = { label: 'Instructions', markdown: original, mode: 'markdown' as const,
      onModeChange: vi.fn(), onMarkdownChange: onChange, onBlur }
    const view = render(<MarkdownAuthoringEditor {...props} />)
    const source = screen.getByRole('textbox', { name: 'Instructions Markdown' })
    view.rerender(<MarkdownAuthoringEditor {...props} interactionActive={false} />)
    expect(source).toHaveValue(original)
    expect(source).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Write' })).toBeDisabled()
    fireEvent.change(source, { target: { value: 'Retired edit' } })
    fireEvent.blur(source)
    await user.click(screen.getByRole('button', { name: 'Write' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(onBlur).not.toHaveBeenCalled()
    expect(props.onModeChange).not.toHaveBeenCalled()
  })
})
