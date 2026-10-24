import { describe, it, expect, vi } from 'vitest'
import {
  applyJsonPatch,
  areJsonDocumentsEqual,
  tryApplyJsonPatch,
  createJsonPatch,
  shouldStoreSnapshot,
} from '@/lib/json-patch'
import type { JsonPatchOperation, TiptapContent } from '@/types'

describe('json-patch utilities', () => {
  it('treats equivalent JSON documents with reordered object keys as equal', () => {
    const left = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    }
    const right = {
      content: [{ content: [{ text: 'Hello', type: 'text' }], type: 'paragraph' }],
      type: 'doc',
    }

    expect(areJsonDocumentsEqual(left, right)).toBe(true)
  })

  it('creates and applies patches to reach the target content', () => {
    const before: TiptapContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
      ],
    }
    const after: TiptapContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
      ],
    }

    const patch = createJsonPatch(before, after)
    const result = applyJsonPatch(before, patch)
    expect(result).toEqual(after)
  })

  it('flags snapshots when the threshold is very low', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
      ],
    }
    const patch = createJsonPatch(content, content)
    expect(shouldStoreSnapshot(patch, content, 0)).toBe(true)
  })

  it('avoids snapshots when the threshold is very high', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
      ],
    }
    const patch = createJsonPatch(content, content)
    expect(shouldStoreSnapshot(patch, content, 1)).toBe(false)
  })

  it('returns base content when patch application fails', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'PRIVATE_STUDENT_DOCUMENT' }] },
      ],
    }

    const invalidPatch: JsonPatchOperation[] = [
      { op: 'add', path: '/content/5/content', value: [{ type: 'text', text: 'PRIVATE_PATCH_VALUE' }] },
    ]

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = applyJsonPatch(content, invalidPatch)
      expect(result).toEqual(content)
      expect(result).not.toBe(content)
      expect(content.content?.[0]?.content?.[0]?.text).toBe('PRIVATE_STUDENT_DOCUMENT')
      expect({ error: consoleErrorSpy.mock.calls, warn: warning.mock.calls }).toEqual({
        error: [], warn: [['Failed to apply JSON patch']],
      })
    } finally {
      consoleErrorSpy.mockRestore()
      warning.mockRestore()
    }
  })

  it('tryApplyJsonPatch returns success true on valid patch', () => {
    const before: TiptapContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
      ],
    }
    const after: TiptapContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
      ],
    }

    const patch = createJsonPatch(before, after)
    const result = tryApplyJsonPatch(before, patch)

    expect(result.success).toBe(true)
    expect(result.content).toEqual(after)
  })

  it('tryApplyJsonPatch returns success false on invalid patch', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'PRIVATE_STUDENT_DOCUMENT' }] },
      ],
    }

    const invalidPatch: JsonPatchOperation[] = [
      { op: 'add', path: '/content/5/content', value: [{ type: 'text', text: 'PRIVATE_PATCH_VALUE' }] },
    ]

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = tryApplyJsonPatch(content, invalidPatch)

      expect(result.success).toBe(false)
      expect(result.content).toEqual(content)
      expect(result.content).not.toBe(content)
      expect(content.content?.[0]?.content?.[0]?.text).toBe('PRIVATE_STUDENT_DOCUMENT')
      expect({ error: consoleErrorSpy.mock.calls, warn: warning.mock.calls }).toEqual({
        error: [], warn: [['Failed to apply JSON patch']],
      })
    } finally {
      consoleErrorSpy.mockRestore()
      warning.mockRestore()
    }
  })
})
