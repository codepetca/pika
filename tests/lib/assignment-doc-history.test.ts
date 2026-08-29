import { describe, it, expect, vi } from 'vitest'
import { createJsonPatch } from '@/lib/json-patch'
import {
  buildAssignmentHistoryPreview,
  compareAssignmentDocContent,
  describeAssignmentHistoryChange,
  reconstructAssignmentDocContent,
} from '@/lib/assignment-doc-history'
import type { AssignmentDocHistoryEntry, JsonPatchOperation, TiptapContent } from '@/types'

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

  it('returns null when a patch fails to apply', () => {
    const base: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }],
    }

    // Invalid patch that references a non-existent path
    const invalidPatch: JsonPatchOperation[] = [
      { op: 'add', path: '/content/5/content', value: [{ type: 'text', text: 'Oops' }] },
    ]

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
        id: 'bad-patch',
        assignment_doc_id: 'doc-1',
        snapshot: null,
        patch: invalidPatch,
        word_count: 1,
        char_count: 6,
        trigger: 'autosave',
        created_at: '2026-01-05T00:00:10Z',
      },
    ]

    const result = reconstructAssignmentDocContent(entries, 'bad-patch')
    expect(result).toBeNull()
  })

  it('returns null when target entry is not found', () => {
    const base: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }],
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
    ]

    const result = reconstructAssignmentDocContent(entries, 'non-existent')
    expect(result).toBeNull()
  })

  it('returns null when no snapshot is found before target', () => {
    const entries: AssignmentDocHistoryEntry[] = [
      {
        id: 'patch-only',
        assignment_doc_id: 'doc-1',
        snapshot: null,
        patch: [{ op: 'add', path: '/content/0', value: { type: 'paragraph' } }],
        word_count: 1,
        char_count: 5,
        trigger: 'autosave',
        created_at: '2026-01-05T00:00:00Z',
      },
    ]

    const result = reconstructAssignmentDocContent(entries, 'patch-only')
    expect(result).toBeNull()
  })

  it('identifies added, modified, and deleted document blocks', () => {
    const before: TiptapContent = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Stable title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Rewrite me' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Remove me' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Stable ending' }] },
      ],
    }
    const after: TiptapContent = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Stable title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Rewritten paragraph' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'New evidence' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Stable ending' }] },
      ],
    }

    expect(compareAssignmentDocContent(before, after)).toEqual({
      changedBlocks: [
        { index: 1, kind: 'modified' },
        { index: 2, kind: 'modified' },
      ],
      deletionAnchors: [],
    })
  })

  it('anchors a pure deletion at its former document position', () => {
    const before: TiptapContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Keep first' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Delete this' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Keep last' }] },
      ],
    }
    const after: TiptapContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Keep first' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Keep last' }] },
      ],
    }

    expect(compareAssignmentDocContent(before, after)).toEqual({
      changedBlocks: [],
      deletionAnchors: [{ index: 1, position: 'before', count: 1 }],
    })
  })

  it('builds a focused preview against the immediately preceding save', () => {
    const first: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }],
    }
    const second: TiptapContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
      ],
    }
    const entries: AssignmentDocHistoryEntry[] = [
      {
        id: 'first', assignment_doc_id: 'doc-1', snapshot: first, patch: null,
        word_count: 1, char_count: 5, trigger: 'baseline', created_at: '2026-01-05T00:00:00Z',
      },
      {
        id: 'second', assignment_doc_id: 'doc-1', snapshot: second, patch: null,
        word_count: 2, char_count: 11, trigger: 'autosave', created_at: '2026-01-05T00:01:00Z',
      },
    ]

    expect(buildAssignmentHistoryPreview(entries, 'second')).toEqual({
      content: second,
      change: {
        changedBlocks: [{ index: 1, kind: 'added' }],
        deletionAnchors: [],
      },
    })
  })

  it('bounds comparison work for very large, substantially changed documents', () => {
    const before: TiptapContent = {
      type: 'doc',
      content: Array.from({ length: 1000 }, (_, index) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: `Before ${index}` }],
      })),
    }
    const after: TiptapContent = {
      type: 'doc',
      content: Array.from({ length: 1000 }, (_, index) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: `After ${index}` }],
      })),
    }
    const stringifySpy = vi.spyOn(JSON, 'stringify')

    const result = compareAssignmentDocContent(before, after)
    const signatureCalls = stringifySpy.mock.calls.length
    stringifySpy.mockRestore()

    expect(signatureCalls).toBe(2000)
    expect(result.changedBlocks).toHaveLength(1000)
    expect(result.deletionAnchors).toEqual([])
  })

  it('keeps a large mostly stable reorder precise beyond the exact LCS bound', () => {
    const blocks = Array.from({ length: 201 }, (_, index) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: `Paragraph ${index}` }],
    }))
    const before: TiptapContent = { type: 'doc', content: blocks }
    const after: TiptapContent = {
      type: 'doc',
      content: [...blocks.slice(1), blocks[0]!],
    }

    expect(compareAssignmentDocContent(before, after)).toEqual({
      changedBlocks: [{ index: 200, kind: 'added' }],
      deletionAnchors: [{ index: 0, position: 'before', count: 1 }],
    })
  })

  it('describes change kinds and document locations for assistive technology', () => {
    expect(describeAssignmentHistoryChange({
      changedBlocks: [
        { index: 2, kind: 'added' },
        { index: 5, kind: 'modified' },
      ],
      deletionAnchors: [{ index: 7, position: 'before', count: 2 }],
    })).toBe(
      'History preview: 1 added area at document block 3; 1 revised area at document block 6; 2 deleted areas near document block 8.',
    )
  })
})
