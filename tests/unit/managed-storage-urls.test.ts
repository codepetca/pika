import { describe, expect, it } from 'vitest'
import {
  getProtectedSubmissionImageUrl,
  parsePublicStoragePath,
} from '@/lib/managed-storage-urls'

describe('managed Storage browser URLs', () => {
  it('prefers an opaque managed object identity', () => {
    expect(getProtectedSubmissionImageUrl({
      managed_object_id: '10000000-0000-4000-8000-000000000001',
      src: 'https://project.supabase.co/storage/v1/object/public/submission-images/legacy.png',
    })).toBe(
      '/api/storage/submission-images?object_id=10000000-0000-4000-8000-000000000001',
    )
  })

  it('rewrites a legacy public submission URL to same-origin delivery', () => {
    expect(getProtectedSubmissionImageUrl({
      src: 'https://project.supabase.co/storage/v1/object/public/submission-images/classrooms/a/work%20sample.png',
    })).toBe('/api/storage/submission-images?path=classrooms%2Fa%2Fwork%20sample.png')
  })

  it('does not rewrite unrelated external images', () => {
    expect(getProtectedSubmissionImageUrl({ src: 'https://images.example.com/work.png' }))
      .toBe('https://images.example.com/work.png')
  })

  it('extracts only the expected private bucket path', () => {
    expect(parsePublicStoragePath(
      'https://project.supabase.co/storage/v1/object/public/test-documents/classrooms/test.pdf',
      'test-documents',
    )).toBe('classrooms/test.pdf')
    expect(parsePublicStoragePath(
      'https://project.supabase.co/storage/v1/object/public/submission-images/classrooms/test.pdf',
      'test-documents',
    )).toBeNull()
  })
})
