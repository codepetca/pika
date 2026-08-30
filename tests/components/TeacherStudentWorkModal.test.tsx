import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TeacherStudentWorkModal } from '@/components/TeacherStudentWorkModal'
import { fetchCachedJSON } from '@/lib/request-cache'
import type { AssignmentDocHistoryEntry, TiptapContent } from '@/types'

vi.mock('@/lib/request-cache', () => ({
  fetchCachedJSON: vi.fn(),
}))

vi.mock('@/components/editor', () => ({
  RichTextViewer: ({
    content,
    historyPreviewMode,
    historyPreviewChange,
  }: {
    content: TiptapContent
    historyPreviewMode: string
    historyPreviewChange?: { changedBlocks: unknown[] } | null
  }) => (
    <div
      data-testid="rich-text-viewer"
      data-mode={historyPreviewMode}
      data-changed-blocks={historyPreviewChange?.changedBlocks.length ?? 0}
    >
      {JSON.stringify(content)}
    </div>
  ),
}))

vi.mock('@/components/HistoryList', () => ({
  HistoryList: ({
    entries,
    onEntryClick,
    onEntryHover,
  }: {
    entries: AssignmentDocHistoryEntry[]
    onEntryClick: (entry: AssignmentDocHistoryEntry) => void
    onEntryHover?: (entry: AssignmentDocHistoryEntry) => void
  }) => (
    <div data-testid="history-list">
      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => onEntryClick(entry)}
          onMouseEnter={() => onEntryHover?.(entry)}
        >
          History save {entry.id}
        </button>
      ))}
    </div>
  ),
}))

const baselineContent: TiptapContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Original second paragraph' }] },
  ],
}

const revisedContent: TiptapContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Revised second paragraph' }] },
  ],
}

const historyEntries: AssignmentDocHistoryEntry[] = [
  {
    id: 'revised',
    assignment_doc_id: 'doc-1',
    patch: null,
    snapshot: revisedContent,
    word_count: 5,
    char_count: 32,
    paste_word_count: null,
    keystroke_count: null,
    trigger: 'autosave',
    created_at: '2025-03-11T20:10:00Z',
  },
  {
    id: 'baseline',
    assignment_doc_id: 'doc-1',
    patch: null,
    snapshot: baselineContent,
    word_count: 5,
    char_count: 33,
    paste_word_count: null,
    keystroke_count: null,
    trigger: 'baseline',
    created_at: '2025-03-10T18:00:00Z',
  },
]

describe('TeacherStudentWorkModal history preview', () => {
  beforeEach(() => {
    vi.mocked(fetchCachedJSON).mockImplementation(async (key) => {
      if (String(key).includes('history')) return { history: historyEntries } as never
      return {
        assignment: { id: 'assignment-1', title: 'Field Study' },
        classroom: { id: 'classroom-1', title: 'Science' },
        student: { id: 'student-1', email: 'student@example.com', name: 'Student One' },
        doc: { id: 'doc-1', content: revisedContent },
        status: 'assigned',
      } as never
    })
  })

  it('focuses hovered changes, pins clicked saves, and lets Escape exit the preview first', async () => {
    const onClose = vi.fn()
    render(
      <TeacherStudentWorkModal
        isOpen
        onClose={onClose}
        assignmentId="assignment-1"
        studentId="student-1"
      />,
    )

    const viewer = await screen.findByTestId('rich-text-viewer')
    expect(viewer).toHaveAttribute('data-mode', 'current')

    const revisedSave = (await screen.findAllByRole('button', { name: 'History save revised' }))[0]
    fireEvent.mouseEnter(revisedSave)

    await waitFor(() => {
      expect(viewer).toHaveAttribute('data-mode', 'focused')
      expect(viewer).toHaveAttribute('data-changed-blocks', '1')
      expect(viewer).toHaveTextContent('Revised second paragraph')
    })

    fireEvent.click(revisedSave)
    await waitFor(() => expect(viewer).toHaveAttribute('data-mode', 'locked'))

    const baselineSave = screen.getAllByRole('button', { name: 'History save baseline' })[0]
    fireEvent.mouseEnter(baselineSave)
    expect(viewer).toHaveAttribute('data-mode', 'locked')
    expect(viewer).toHaveTextContent('Revised second paragraph')

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(viewer).toHaveAttribute('data-mode', 'current'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
