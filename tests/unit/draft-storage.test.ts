import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  saveDraft,
  loadDraft,
  clearDraft,
  clearAllDrafts,
  type DraftEntry,
} from '@/lib/draft-storage'

describe('draft-storage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  describe('saveDraft', () => {
    it('should save draft to localStorage', () => {
      const draft = {
        classroomId: 'classroom-1',
        date: '2025-01-15',
        text: 'This is a draft entry',
      }

      saveDraft(draft)

      const key = `pika_entry_draft_${draft.classroomId}_${draft.date}`
      const stored = localStorage.getItem(key)
      expect(stored).toBeTruthy()

      const parsed: DraftEntry = JSON.parse(stored!)
      expect(parsed.classroomId).toBe(draft.classroomId)
      expect(parsed.date).toBe(draft.date)
      expect(parsed.text).toBe(draft.text)
      expect(parsed.savedAt).toBeGreaterThan(0)
    })

    it('should overwrite existing draft', () => {
      const draft = {
        classroomId: 'classroom-1',
        date: '2025-01-15',
        text: 'First version',
      }

      saveDraft(draft)
      saveDraft({ ...draft, text: 'Second version' })

      const result = loadDraft(draft.classroomId, draft.date)
      expect(result?.text).toBe('Second version')
    })

    it('should handle localStorage errors gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

      saveDraft({
        classroomId: 'classroom-1',
        date: '2025-01-15',
        text: 'Test',
      })

      expect(consoleErrorSpy).toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
      setItemSpy.mockRestore()
    })
  })

  describe('loadDraft', () => {
    it('should load draft when no server entry exists', () => {
      const draft = {
        classroomId: 'classroom-1',
        date: '2025-01-15',
        text: 'Draft text',
      }

      saveDraft(draft)

      const result = loadDraft(draft.classroomId, draft.date)
      expect(result).toBeTruthy()
      expect(result?.text).toBe(draft.text)
      expect(result?.isDraftNewer).toBe(true)
    })

    it('should indicate draft is newer than server entry', () => {
      const draft = {
        classroomId: 'classroom-1',
        date: '2025-01-15',
        text: 'Newer draft',
      }

      // Server entry updated 1 hour ago
      const serverUpdatedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()

      saveDraft(draft)

      const result = loadDraft(draft.classroomId, draft.date, serverUpdatedAt)
      expect(result?.isDraftNewer).toBe(true)
      expect(result?.text).toBe(draft.text)
    })

    it('should indicate draft is older than server entry', () => {
      const draft = {
        classroomId: 'classroom-1',
        date: '2025-01-15',
        text: 'Old draft',
      }

      saveDraft(draft)

      // Server entry updated just now (newer than draft)
      const serverUpdatedAt = new Date(Date.now() + 1000).toISOString()

      const result = loadDraft(draft.classroomId, draft.date, serverUpdatedAt)
      expect(result?.isDraftNewer).toBe(false)
      expect(result?.text).toBe(draft.text)
    })

    it('should return null if no draft exists', () => {
      const result = loadDraft('classroom-1', '2025-01-15')
      expect(result).toBe(null)
    })

    it('should return null if draft is for different classroom', () => {
      saveDraft({
        classroomId: 'classroom-1',
        date: '2025-01-15',
        text: 'Draft',
      })

      const result = loadDraft('classroom-2', '2025-01-15')
      expect(result).toBe(null)
    })

    it('should return null if draft is for different date', () => {
      saveDraft({
        classroomId: 'classroom-1',
        date: '2025-01-15',
        text: 'Draft',
      })

      const result = loadDraft('classroom-1', '2025-01-16')
      expect(result).toBe(null)
    })

    it('should handle corrupted localStorage data', () => {
      const key = 'pika_entry_draft_classroom-1_2025-01-15'
      localStorage.setItem(key, 'invalid json')

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = loadDraft('classroom-1', '2025-01-15')
      expect(result).toBe(null)
      expect(consoleErrorSpy).toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
    })

    it('should validate draft structure', () => {
      const key = 'pika_entry_draft_classroom-1_2025-01-15'
      localStorage.setItem(
        key,
        JSON.stringify({
          // Missing required fields
          classroomId: 'classroom-1',
          date: '2025-01-15',
          // text missing
          savedAt: Date.now(),
        })
      )

      const result = loadDraft('classroom-1', '2025-01-15')
      expect(result).toBe(null)
    })
  })

  describe('clearDraft', () => {
    it('should clear draft from localStorage', () => {
      const draft = {
        classroomId: 'classroom-1',
        date: '2025-01-15',
        text: 'Draft to clear',
      }

      saveDraft(draft)
      expect(loadDraft(draft.classroomId, draft.date)).toBeTruthy()

      clearDraft(draft.classroomId, draft.date)
      expect(loadDraft(draft.classroomId, draft.date)).toBe(null)
    })

    it('should not error if draft does not exist', () => {
      expect(() => clearDraft('classroom-1', '2025-01-15')).not.toThrow()
    })
  })

  describe('clearAllDrafts', () => {
    it('should clear all drafts from localStorage', () => {
      saveDraft({
        classroomId: 'classroom-1',
        date: '2025-01-15',
        text: 'Draft 1',
      })
      saveDraft({
        classroomId: 'classroom-2',
        date: '2025-01-16',
        text: 'Draft 2',
      })

      // Add some non-draft items
      localStorage.setItem('other_key', 'value')

      clearAllDrafts()

      expect(loadDraft('classroom-1', '2025-01-15')).toBe(null)
      expect(loadDraft('classroom-2', '2025-01-16')).toBe(null)
      expect(localStorage.getItem('other_key')).toBe('value')
    })

    it('should handle empty localStorage', () => {
      expect(() => clearAllDrafts()).not.toThrow()
    })
  })
})
