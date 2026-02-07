/**
 * Unit tests for image upload utilities
 */

import { describe, it, expect } from 'vitest'
import {
  IMAGE_ALLOWED_TYPES,
  IMAGE_MAX_SIZE,
  IMAGE_MAX_SIZE_MB,
  IMAGE_ACCEPT,
  isAllowedImageType,
  isWithinSizeLimit,
  getImageValidationError,
} from '@/lib/image-upload'

describe('image-upload utilities', () => {
  // ==========================================================================
  // Constants
  // ==========================================================================

  describe('constants', () => {
    it('should have correct allowed types', () => {
      expect(IMAGE_ALLOWED_TYPES).toContain('image/png')
      expect(IMAGE_ALLOWED_TYPES).toContain('image/jpeg')
      expect(IMAGE_ALLOWED_TYPES).toContain('image/gif')
      expect(IMAGE_ALLOWED_TYPES).toContain('image/webp')
      expect(IMAGE_ALLOWED_TYPES).toHaveLength(4)
    })

    it('should have correct max size (10MB)', () => {
      expect(IMAGE_MAX_SIZE).toBe(10 * 1024 * 1024)
    })

    it('should have correct max size in MB', () => {
      expect(IMAGE_MAX_SIZE_MB).toBe(10)
    })

    it('should have correct accept string', () => {
      expect(IMAGE_ACCEPT).toBe('image/*')
    })
  })

  // ==========================================================================
  // isAllowedImageType
  // ==========================================================================

  describe('isAllowedImageType', () => {
    it('should return true for PNG', () => {
      expect(isAllowedImageType('image/png')).toBe(true)
    })

    it('should return true for JPEG', () => {
      expect(isAllowedImageType('image/jpeg')).toBe(true)
    })

    it('should return true for GIF', () => {
      expect(isAllowedImageType('image/gif')).toBe(true)
    })

    it('should return true for WebP', () => {
      expect(isAllowedImageType('image/webp')).toBe(true)
    })

    it('should return false for PDF', () => {
      expect(isAllowedImageType('application/pdf')).toBe(false)
    })

    it('should return false for SVG', () => {
      expect(isAllowedImageType('image/svg+xml')).toBe(false)
    })

    it('should return false for text', () => {
      expect(isAllowedImageType('text/plain')).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isAllowedImageType('')).toBe(false)
    })
  })

  // ==========================================================================
  // isWithinSizeLimit
  // ==========================================================================

  describe('isWithinSizeLimit', () => {
    it('should return true for small files', () => {
      expect(isWithinSizeLimit(1024)).toBe(true) // 1KB
    })

    it('should return true for files at exactly the limit', () => {
      expect(isWithinSizeLimit(IMAGE_MAX_SIZE)).toBe(true)
    })

    it('should return false for files over the limit', () => {
      expect(isWithinSizeLimit(IMAGE_MAX_SIZE + 1)).toBe(false)
    })

    it('should return true for zero size', () => {
      expect(isWithinSizeLimit(0)).toBe(true)
    })
  })

  // ==========================================================================
  // getImageValidationError
  // ==========================================================================

  describe('getImageValidationError', () => {
    // Helper to create mock files
    function createMockFile(type: string, size: number): File {
      return { type, size, name: 'test.png' } as File
    }

    it('should return null for valid PNG under size limit', () => {
      const file = createMockFile('image/png', 1024)
      expect(getImageValidationError(file)).toBeNull()
    })

    it('should return null for valid JPEG under size limit', () => {
      const file = createMockFile('image/jpeg', 5 * 1024 * 1024)
      expect(getImageValidationError(file)).toBeNull()
    })

    it('should return error for invalid file type', () => {
      const file = createMockFile('application/pdf', 1024)
      const error = getImageValidationError(file)
      expect(error).toContain('Invalid file type')
      expect(error).toContain('PNG')
      expect(error).toContain('JPEG')
    })

    it('should return error for file exceeding size limit', () => {
      const file = createMockFile('image/png', IMAGE_MAX_SIZE + 1)
      const error = getImageValidationError(file)
      expect(error).toContain('File too large')
      expect(error).toContain('10MB')
    })

    it('should check type before size (return type error for invalid type even if also too large)', () => {
      const file = createMockFile('application/pdf', IMAGE_MAX_SIZE + 1)
      const error = getImageValidationError(file)
      expect(error).toContain('Invalid file type')
    })

    it('should return null for file at exactly the size limit', () => {
      const file = createMockFile('image/png', IMAGE_MAX_SIZE)
      expect(getImageValidationError(file)).toBeNull()
    })
  })
})
