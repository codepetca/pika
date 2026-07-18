import { describe, expect, it, vi } from 'vitest'
import { persistVersionedHistory } from '@/lib/server/versioned-history'

describe('persistVersionedHistory', () => {
  it('never coalesces an autosave into an authoritative submit entry', async () => {
    const update = vi.fn()
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: { id: 'history-autosave', trigger: 'autosave' },
          error: null,
        })),
      })),
    }))
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    id: 'history-submit',
                    created_at: new Date().toISOString(),
                    trigger: 'submit',
                    paste_word_count: 0,
                    keystroke_count: 0,
                  },
                  error: null,
                })),
              })),
            })),
          })),
        })),
        update,
        insert,
      })),
    }

    const result = await persistVersionedHistory({
      supabase,
      table: 'assignment_doc_history',
      ownerColumn: 'assignment_doc_id',
      ownerId: 'doc-1',
      previousContent: { value: 'submitted' },
      nextContent: { value: 'new draft' },
      selectFields: '*',
      trigger: 'autosave',
      historyMinIntervalMs: 15_000,
      buildMetrics: () => ({ word_count: 2, char_count: 9 }),
    })

    expect(update).not.toHaveBeenCalled()
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      assignment_doc_id: 'doc-1',
      trigger: 'autosave',
    }))
    expect(result).toEqual({ id: 'history-autosave', trigger: 'autosave' })
  })
})
