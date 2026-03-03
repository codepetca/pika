export interface TextareaIndentResult {
  value: string
  selectionStart: number
  selectionEnd: number
  changed: boolean
}

interface ApplyTextareaIndentInput {
  value: string
  selectionStart: number
  selectionEnd: number
  shiftKey?: boolean
  indent?: string
}

const DEFAULT_INDENT = '    '

function getLineStart(value: string, position: number): number {
  const previousLineBreak = value.lastIndexOf('\n', Math.max(0, position - 1))
  return previousLineBreak === -1 ? 0 : previousLineBreak + 1
}

function getLineEnd(value: string, position: number): number {
  const nextLineBreak = value.indexOf('\n', Math.max(0, position))
  return nextLineBreak === -1 ? value.length : nextLineBreak
}

function removeLeadingIndent(line: string, indent: string): { line: string; removed: number } {
  if (line.startsWith(indent)) {
    return { line: line.slice(indent.length), removed: indent.length }
  }
  if (line.startsWith('\t')) {
    return { line: line.slice(1), removed: 1 }
  }
  return { line, removed: 0 }
}

export function applyTextareaIndent({
  value,
  selectionStart,
  selectionEnd,
  shiftKey = false,
  indent = DEFAULT_INDENT,
}: ApplyTextareaIndentInput): TextareaIndentResult {
  if (!shiftKey) {
    if (selectionStart === selectionEnd) {
      const nextValue = value.slice(0, selectionStart) + indent + value.slice(selectionEnd)
      const nextCaret = selectionStart + indent.length
      return {
        value: nextValue,
        selectionStart: nextCaret,
        selectionEnd: nextCaret,
        changed: true,
      }
    }

    const lineStart = getLineStart(value, selectionStart)
    const endAnchor = selectionEnd > selectionStart ? selectionEnd - 1 : selectionEnd
    const lineEnd = getLineEnd(value, endAnchor)
    const block = value.slice(lineStart, lineEnd)
    const lines = block.split('\n')
    const indentedBlock = lines.map((line) => indent + line).join('\n')
    const nextValue = value.slice(0, lineStart) + indentedBlock + value.slice(lineEnd)

    return {
      value: nextValue,
      selectionStart: selectionStart + indent.length,
      selectionEnd: selectionEnd + indent.length * lines.length,
      changed: true,
    }
  }

  if (selectionStart === selectionEnd) {
    const lineStart = getLineStart(value, selectionStart)
    const lineEnd = getLineEnd(value, selectionStart)
    const line = value.slice(lineStart, lineEnd)
    const { line: unindentedLine, removed } = removeLeadingIndent(line, indent)
    if (removed === 0) {
      return { value, selectionStart, selectionEnd, changed: false }
    }

    const nextValue = value.slice(0, lineStart) + unindentedLine + value.slice(lineEnd)
    const nextCaret = Math.max(lineStart, selectionStart - removed)
    return {
      value: nextValue,
      selectionStart: nextCaret,
      selectionEnd: nextCaret,
      changed: true,
    }
  }

  const lineStart = getLineStart(value, selectionStart)
  const endAnchor = selectionEnd > selectionStart ? selectionEnd - 1 : selectionEnd
  const lineEnd = getLineEnd(value, endAnchor)
  const block = value.slice(lineStart, lineEnd)
  const lines = block.split('\n')

  const removedPerLine: number[] = []
  const unindentedLines = lines.map((line) => {
    const { line: nextLine, removed } = removeLeadingIndent(line, indent)
    removedPerLine.push(removed)
    return nextLine
  })
  const totalRemoved = removedPerLine.reduce((sum, removed) => sum + removed, 0)

  if (totalRemoved === 0) {
    return { value, selectionStart, selectionEnd, changed: false }
  }

  const nextBlock = unindentedLines.join('\n')
  const nextValue = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd)
  return {
    value: nextValue,
    selectionStart: Math.max(lineStart, selectionStart - removedPerLine[0]),
    selectionEnd: Math.max(lineStart, selectionEnd - totalRemoved),
    changed: true,
  }
}
