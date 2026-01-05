import { describe, it, expect } from 'vitest'
import { applyJsonPatch, createJsonPatch, shouldStoreSnapshot } from '@/lib/json-patch'
import type { TiptapContent } from '@/types'

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
})
