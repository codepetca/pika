import { describe, it, expect, beforeEach } from 'vitest'
import {
  readCookieValue,
  safeSessionGetJson,
  safeSessionSetJson,
} from '@/lib/client-storage'

describe('client-storage', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  describe('readCookieValue', () => {
    it('returns null when missing', () => {
      expect(readCookieValue('a=1; b=2', 'c')).toBeNull()
    })

    it('parses and decodes cookie values', () => {
      expect(readCookieValue('pika=hello%20world', 'pika')).toBe('hello world')
    })
  })

  describe('session JSON helpers', () => {
    it('round-trips JSON safely', () => {
      safeSessionSetJson('k', { a: 1 })
      expect(safeSessionGetJson<{ a: number }>('k')).toEqual({ a: 1 })
    })

    it('returns null for invalid JSON', () => {
      window.sessionStorage.setItem('k', '{not json')
      expect(safeSessionGetJson('k')).toBeNull()
    })
  })
})

