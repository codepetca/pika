import { describe, expect, it } from 'vitest'
import { areSubmittedAssignmentContentsEqual } from '@/lib/assignment-doc-content'
import type { TiptapContent } from '@/types'

const id = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const source = `/api/storage/submission-images?object_id=${id}`
const attrs = { managed_object_id: id, src: source, alt: 'Evidence', title: 'My photo', width: 480 }
const path = 'student/assignment/photo.png'
const origins = { origin: 'https://pika.example', publicStorageOrigin: 'https://project.supabase.co' }
const completeAttrs = { ...attrs, storage_bucket: 'submission-images', storage_path: path }

function documentWithImage(imageAttrs: Record<string, unknown>, text = 'Latest unsaved work'): TiptapContent {
  return { type: 'doc', content: [{ type: 'blockquote', content: [
    { type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] },
    { type: 'image', attrs: imageAttrs },
  ] }] }
}

describe('submitted assignment content comparison', () => {
  it.each([
    `https://pika.example${source}`,
    `/api/storage/submission-images?path=${encodeURIComponent(path)}`,
    `https://project.supabase.co/storage/v1/object/public/submission-images/${path}`,
  ])('recognizes an acknowledged repair of %s', (src) => {
    const { managed_object_id: _id, ...displayAttrs } = attrs
    expect(areSubmittedAssignmentContentsEqual(
      documentWithImage({ ...displayAttrs, src }), documentWithImage(completeAttrs), origins,
    )).toBe(true)
  })

  it.each([
    { ...attrs, src: `/api/storage/submission-images?path=other/photo.png` },
    { ...attrs, storage_bucket: 'submission-images', storage_path: 'other/photo.png' },
    { ...attrs, src: 'https://project.supabase.co/storage/v1/object/public/submission-images/other/photo.png' },
    { ...completeAttrs, storage_bucket: 'test-documents' },
    { src: `https://foreign.example${source}`, alt: attrs.alt, title: attrs.title, width: attrs.width },
    { src: `https://foreign.example/api/storage/submission-images?path=${encodeURIComponent(path)}`, alt: attrs.alt, title: attrs.title, width: attrs.width },
    { src: `https://foreign.example/storage/v1/object/public/submission-images/${path}`, alt: attrs.alt, title: attrs.title, width: attrs.width },
  ])('rejects conflicting paths or unknown source hosts: %j', (imageAttrs) => {
    expect(areSubmittedAssignmentContentsEqual(documentWithImage(imageAttrs), documentWithImage(completeAttrs), origins)).toBe(false)
  })

  it('does not derive a path alias when acknowledged images disagree about its identity', () => {
    const left = documentWithImage({ src: `/api/storage/submission-images?path=${encodeURIComponent(path)}`, alt: attrs.alt, title: attrs.title, width: attrs.width })
    const right = documentWithImage(completeAttrs)
    right.content![0].content!.push({ type: 'image', attrs: { ...completeAttrs, managed_object_id: otherId, src: `/api/storage/submission-images?object_id=${otherId}` } })
    left.content![0].content!.push({ type: 'image', attrs: { ...completeAttrs, managed_object_id: otherId, src: `/api/storage/submission-images?object_id=${otherId}` } })
    expect(areSubmittedAssignmentContentsEqual(left, right, origins)).toBe(false)
  })

  it('ignores repaired managed storage bookkeeping without mutating either document', () => {
    const before = documentWithImage(attrs)
    const repaired = documentWithImage({ ...attrs, storage_bucket: 'submission-images', storage_path: 'student/assignment/photo.png' })
    const originals = structuredClone([before, repaired])
    expect(areSubmittedAssignmentContentsEqual(before, repaired)).toBe(true)
    expect([before, repaired]).toEqual(originals)
  })

  it('recognizes managed identity in a relative protected URL when the attribute was omitted', () => {
    const { managed_object_id: _id, ...urlOnly } = attrs
    expect(areSubmittedAssignmentContentsEqual(documentWithImage(urlOnly), documentWithImage(attrs))).toBe(true)
  })

  it('normalizes a repaired source for the same explicit managed identity', () => {
    expect(areSubmittedAssignmentContentsEqual(
      documentWithImage({ ...attrs, src: 'https://storage.example/old-public-photo.png' }),
      documentWithImage(attrs),
    )).toBe(true)
  })

  it('treats null optional managed defaults as absent on an ordinary external image', () => {
    const external = { src: 'https://example.com/photo.png', alt: 'External photo' }
    expect(areSubmittedAssignmentContentsEqual(
      documentWithImage({ ...external, managed_object_id: null, storage_bucket: null, storage_path: null }),
      documentWithImage(external),
    )).toBe(true)
  })

  it.each([
    { ...attrs, managed_object_id: otherId, src: `/api/storage/submission-images?object_id=${otherId}` },
    { ...attrs, alt: 'Changed description' },
    { ...attrs, title: 'Changed title' },
    { ...attrs, width: 481 },
    { ...attrs, height: 200 },
    { ...attrs, managed_object_id: 'invalid' },
    { src: `https://foreign.example${source}`, alt: 'Evidence', title: 'My photo', width: 480 },
    { src: `//foreign.example${source}`, alt: 'Evidence', title: 'My photo', width: 480 },
    { src: `/api/storage/submission-images?path=student/photo.png`, alt: 'Evidence', title: 'My photo', width: 480 },
    { ...attrs, src: `/api/storage/submission-images?object_id=${otherId}` },
  ])('retains image identity and presentation differences: %j', (changed) => {
    expect(areSubmittedAssignmentContentsEqual(documentWithImage(attrs), documentWithImage(changed))).toBe(false)
  })

  it('retains text, formatting, node ordering and external-image source differences', () => {
    const original = documentWithImage(attrs)
    expect(areSubmittedAssignmentContentsEqual(original, documentWithImage(attrs, 'Newer local text'))).toBe(false)
    const unformatted = structuredClone(original)
    delete unformatted.content![0].content![0].content![0].marks
    expect(areSubmittedAssignmentContentsEqual(original, unformatted)).toBe(false)
    const reordered = structuredClone(original)
    reordered.content![0].content!.reverse()
    expect(areSubmittedAssignmentContentsEqual(original, reordered)).toBe(false)
    expect(areSubmittedAssignmentContentsEqual(documentWithImage({ src: 'https://example.com/one.png' }), documentWithImage({ src: 'https://example.com/two.png' }))).toBe(false)
  })
})
