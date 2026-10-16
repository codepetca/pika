// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extension-placeholder'
import { parse } from 'postcss'
import { compileString } from 'sass'
import { afterEach, describe, expect, it } from 'vitest'
import { applyContextualTestFontOverlay, contextualTestFontOverlay as overlay } from '../../e2e/helpers/contextual-test-font-overlay'

const source = readFileSync(overlay.path)
// Works before and after visual acceptance without requiring historical Git
// objects in a shallow CI checkout. Both alternatives have exact byte hashes.
const candidate = createHash('sha256').update(source).digest('hex') === overlay.afterSha256
  ? source : applyContextualTestFontOverlay(overlay.path, source)
// Match the real compiled candidate's generated-content rules, rather than a
// hand-written copy of the proposed selector. JSDOM does not render ::before.
const selectors: string[] = []
parse(compileString(candidate.toString()).css).walkRules(rule => {
  if (rule.nodes.some(node => node.type === 'decl' && node.prop === 'content' && node.value === 'attr(data-placeholder)')) {
    selectors.push(...rule.selector.split(',').map(selector => selector.trim()).filter(selector => selector.endsWith('::before')).map(selector => selector.slice(0, -'::before'.length)))
  }
})
const matchesCandidatePlaceholder = (node: Element) => selectors.some(selector => node.matches(selector))
const editors: Editor[] = []
function createEditor(content: string, editable = true) {
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    editable,
    extensions: [StarterKit, Placeholder.configure({ placeholder: 'Write your response here...', includeChildren: true })],
    content,
    editorProps: { handleScrollToSelection: () => true },
  })
  editors.push(editor)
  return editor
}
function assertEmptyPlaceholder(editor: Editor) {
  const root = editor.view.dom, paragraph = root.firstElementChild!
  expect(editor.isEmpty).toBe(true)
  expect(root.children).toHaveLength(1)
  expect(paragraph.tagName).toBe('P')
  expect(paragraph).toHaveClass('is-empty')
  expect(paragraph).toHaveAttribute('data-placeholder', 'Write your response here...')
  expect(paragraph.childNodes).toHaveLength(1)
  expect(paragraph.firstElementChild).toHaveClass('ProseMirror-trailingBreak')
  expect(matchesCandidatePlaceholder(paragraph)).toBe(true)
}
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); document.body.innerHTML = '' })

describe('real Tiptap empty-placeholder candidate CSS (CPU contract, not visual evidence)', () => {
  it('reproduces a DOM-only select-all followed by Delete before selectionchange leaving the old model caret intact', () => {
    const editor = createEditor('<p>Existing response</p>')
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    const element = editor.view.dom
    element.focus()
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    element.focus()
    expect(selection.toString()).toBe('Existing response')
    expect(editor.state.selection.empty).toBe(true)
    const deletion = new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', keyCode: 46, which: 46, bubbles: true, cancelable: true })
    element.dispatchEvent(deletion)
    expect(deletion.defaultPrevented).toBe(true)
    expect(editor.getText()).toBe('Existing response')
  })
  it('clears through the real keyboard keymap without waiting for a DOM selectionchange or adding a post-delete action', () => {
    const editor = createEditor('<p>Existing response</p>')
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    const element = editor.view.dom
    element.focus()
    // JSDOM reports a non-Mac platform; Control is Tiptap's Mod key here.
    const selectAll = new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, which: 65, ctrlKey: true, bubbles: true, cancelable: true })
    element.dispatchEvent(selectAll)
    expect(selectAll.defaultPrevented).toBe(true)
    expect(editor.state.selection.empty).toBe(false)
    const deletion = new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true })
    element.dispatchEvent(deletion)
    expect(deletion.defaultPrevented).toBe(true)
    assertEmptyPlaceholder(editor)
  })
  it('matches the sole empty paragraph immediately after deleting text, without another selection transaction', () => {
    const editor = createEditor('<p>Local font review: evidence, observations, and interpretation.</p>')
    editor.commands.selectAll()
    editor.commands.deleteSelection()
    assertEmptyPlaceholder(editor)
  })
  it('keeps matching through repeated edits and deletions', () => {
    const editor = createEditor('<p>Initial response</p>')
    for (let index = 0; index < 3; index++) {
      editor.commands.selectAll()
      editor.commands.deleteSelection()
      assertEmptyPlaceholder(editor)
      editor.commands.insertContent('Next response')
      expect(matchesCandidatePlaceholder(editor.view.dom.firstElementChild!)).toBe(false)
    }
  })
  it('preserves the initially empty editor placeholder', () => {
    assertEmptyPlaceholder(createEditor('<p></p>'))
  })
  it('does not match an empty first paragraph when a second content block exists', () => {
    const editor = createEditor('<p></p><p>Existing response</p>')
    const paragraph = editor.view.dom.firstElementChild!
    expect(paragraph).toHaveClass('is-empty')
    expect(Array.from(editor.view.dom.querySelectorAll('p')).some(matchesCandidatePlaceholder)).toBe(false)
  })
  it('does not match a nested empty paragraph in a nonempty document', () => {
    const editor = createEditor('<blockquote><p></p></blockquote><p>Existing response</p>')
    const paragraph = editor.view.dom.querySelector('blockquote > p')!
    expect(paragraph).toHaveClass('is-empty')
    expect(Array.from(editor.view.dom.querySelectorAll('p')).some(matchesCandidatePlaceholder)).toBe(false)
  })
  it('does not match paragraphs containing text', () => {
    const editor = createEditor('<p>Existing response</p>')
    expect(selectors.length).toBeGreaterThan(0)
    expect(matchesCandidatePlaceholder(editor.view.dom.firstElementChild!)).toBe(false)
  })
  it('keeps placeholders absent from read-only content and read-only empty editors', () => {
    for (const content of ['<p>Saved response</p>', '<p></p>']) {
      const editor = createEditor(content, false)
      expect(editor.isEditable).toBe(false)
      expect(Array.from(editor.view.dom.querySelectorAll('p')).some(matchesCandidatePlaceholder)).toBe(false)
    }
  })
})
