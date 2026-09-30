/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { findExamTextMatches } from '@/lib/exam-text-find'

function root(html: string) {
  const element = document.createElement('div')
  element.innerHTML = html
  return element
}

describe('findExamTextMatches', () => {
  it('finds case-insensitive literal text across formatting, excluding answers and frames', () => {
    const element = root('<div data-exam-search-text><p>A <strong>LOOP</strong> repeats. Loop repeats again.</p></div><textarea>loop repeats</textarea><button>loop repeats</button><iframe title="loop repeats"></iframe>')
    const matches = findExamTextMatches(element, 'loop repeats')
    expect(matches.map((match) => match.range.toString())).toEqual(['LOOP repeats', 'Loop repeats'])
    expect(matches[0].documentId).toBeNull()
    expect(findExamTextMatches(element, '.*')).toEqual([])
  })

  it('includes unopened text references and identifies the matching document', () => {
    const element = root('<div hidden aria-hidden="true" data-exam-find-document="ref-1" data-exam-find-label="Loop reference"><div data-exam-search-text><p>Use a loop.</p></div></div>')
    const matches = findExamTextMatches(element, 'loop')
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ documentId: 'ref-1', label: 'Loop reference' })
  })

  it('treats paragraph and line boundaries as whitespace without inventing joined words', () => {
    const element = root('<div data-exam-search-text><p>first</p><p>second<br><strong>third</strong></p></div>')
    expect(findExamTextMatches(element, 'firstsecond')).toEqual([])
    expect(findExamTextMatches(element, 'secondthird')).toEqual([])
    expect(findExamTextMatches(element, 'second third')).toHaveLength(1)
    expect(findExamTextMatches(element, '   ')).toEqual([])
  })
})
