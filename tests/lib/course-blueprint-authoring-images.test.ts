import { describe, expect, it } from 'vitest'
import { containsCourseBlueprintAuthoringImage, containsPikaManagedStorageUrl, isPikaManagedStorageUrl } from '@/lib/course-blueprint-package-storage-policy'

const path = '/api/storage/authoring-images?object_id=c2910000-0000-4000-8000-000000000101'

describe('Blueprint authoring-image portability boundary', () => {
  it.each([path, `https://pika.example${path}`, `https://other.example${path}`, `/api/storage/%61uthoring-images?object_id=123`])(
    'rejects private application image reference %s without requiring Supabase configuration', value => {
      expect(isPikaManagedStorageUrl(value, '')).toBe(true)
      expect(containsPikaManagedStorageUrl(`![Image](${value})`, '')).toBe(true)
      expect(containsCourseBlueprintAuthoringImage({ assignments: [{ instructions_markdown: `Before ![Image](${value}) after` }] })).toBe(true)
    },
  )

  it('keeps ordinary links and existing managed Test-document copy semantics unchanged', () => {
    const testDocument = 'https://project.supabase.co/storage/v1/object/public/test-documents/reference.png'
    expect(containsCourseBlueprintAuthoringImage({ documents: [{ source: 'upload', url: testDocument }] })).toBe(false)
    expect(isPikaManagedStorageUrl(testDocument, 'https://project.supabase.co')).toBe(true)
    expect(isPikaManagedStorageUrl(testDocument, 'https://other.supabase.co')).toBe(false)
    expect(containsCourseBlueprintAuthoringImage({ content: '![External](https://example.com/image.png)' })).toBe(false)
  })
})
