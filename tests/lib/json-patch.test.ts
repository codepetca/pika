import { describe, it, expect } from 'vitest'
import { applyJsonPatch, tryApplyJsonPatch, createJsonPatch, shouldStoreSnapshot } from '@/lib/json-patch'
import type { JsonPatchOperation, TiptapContent } from '@/types'

describe('json-patch utilities', () => {
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
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
      ],
    }

    const invalidPatch: JsonPatchOperation[] = [
      { op: 'add', path: '/content/5/content', value: [{ type: 'text', text: 'Oops' }] },
    ]

    expect(applyJsonPatch(content, invalidPatch)).toEqual(content)
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
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
      ],
    }

    const invalidPatch: JsonPatchOperation[] = [
      { op: 'add', path: '/content/5/content', value: [{ type: 'text', text: 'Oops' }] },
    ]

    const result = tryApplyJsonPatch(content, invalidPatch)

    expect(result.success).toBe(false)
    expect(result.content).toEqual(content)
  })
})
