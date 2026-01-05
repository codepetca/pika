import { describe, it, expect } from 'vitest'
import { createJsonPatch } from '@/lib/json-patch'
import { reconstructAssignmentDocContent } from '@/lib/assignment-doc-history'
import type { AssignmentDocHistoryEntry, TiptapContent } from '@/types'

describe('assignment-doc-history reconstruction', () => {
  it('reconstructs content from snapshot and patches', () => {
    const base: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }],
    }
    const second: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }],
    }
    const third: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Third' }] }],
    }

    const entries: AssignmentDocHistoryEntry[] = [
      {
        id: 'baseline',
        assignment_doc_id: 'doc-1',
        snapshot: base,
        patch: null,
        word_count: 1,
        char_count: 5,
        trigger: 'baseline',
        created_at: '2026-01-05T00:00:00Z',
      },
      {
        id: 'patch-1',
        assignment_doc_id: 'doc-1',
        snapshot: null,
        patch: createJsonPatch(base, second),
        word_count: 1,
        char_count: 6,
        trigger: 'autosave',
        created_at: '2026-01-05T00:00:10Z',
      },
      {
        id: 'patch-2',
        assignment_doc_id: 'doc-1',
        snapshot: null,
        patch: createJsonPatch(second, third),
        word_count: 1,
        char_count: 5,
        trigger: 'autosave',
        created_at: '2026-01-05T00:00:20Z',
      },
    ]

    const result = reconstructAssignmentDocContent(entries, 'patch-2')
    expect(result).toEqual(third)
  })
})
