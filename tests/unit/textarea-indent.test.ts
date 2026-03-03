import { describe, expect, it } from 'vitest'
import { applyTextareaIndent } from '@/lib/textarea-indent'

describe('textarea indent utility', () => {
  it('inserts indentation when tab is pressed with a collapsed caret', () => {
    const result = applyTextareaIndent({
      value: 'console.log(1)',
      selectionStart: 0,
      selectionEnd: 0,
    })

    expect(result).toEqual({
      value: '    console.log(1)',
      selectionStart: 4,
      selectionEnd: 4,
      changed: true,
    })
  })

  it('indents each selected line on tab', () => {
    const result = applyTextareaIndent({
      value: 'line1\nline2\nline3',
      selectionStart: 0,
      selectionEnd: 11,
    })

    expect(result.value).toBe('    line1\n    line2\nline3')
    expect(result.selectionStart).toBe(4)
    expect(result.selectionEnd).toBe(19)
    expect(result.changed).toBe(true)
  })

  it('unindents the current line on shift+tab with collapsed caret', () => {
    const result = applyTextareaIndent({
      value: '    line1\nline2',
      selectionStart: 5,
      selectionEnd: 5,
      shiftKey: true,
    })

    expect(result.value).toBe('line1\nline2')
    expect(result.selectionStart).toBe(1)
    expect(result.selectionEnd).toBe(1)
    expect(result.changed).toBe(true)
  })

  it('unindents selected lines on shift+tab', () => {
    const result = applyTextareaIndent({
      value: '    line1\n    line2\nline3',
      selectionStart: 0,
      selectionEnd: 19,
      shiftKey: true,
    })

    expect(result.value).toBe('line1\nline2\nline3')
    expect(result.selectionStart).toBe(0)
    expect(result.selectionEnd).toBe(11)
    expect(result.changed).toBe(true)
  })

  it('returns unchanged when shift+tab is pressed on non-indented content', () => {
    const result = applyTextareaIndent({
      value: 'line1\nline2',
      selectionStart: 0,
      selectionEnd: 5,
      shiftKey: true,
    })

    expect(result).toEqual({
      value: 'line1\nline2',
      selectionStart: 0,
      selectionEnd: 5,
      changed: false,
    })
  })
})
