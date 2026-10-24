import { afterEach, describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { ManagedImage } from '@/components/tiptap-node/managed-image-node'

const editors: Editor[] = []

function createEditor(content: JSONContent | string = '') {
  const editor = new Editor({
    extensions: [StarterKit, ManagedImage],
    content,
  })
  editors.push(editor)
  return editor
}

function imageAttributes(editor: Editor) {
  const images: Record<string, unknown>[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image') images.push(node.attrs)
  })
  expect(images).toHaveLength(1)
  return images[0]
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
})

describe('ManagedImage HTML clipboard contract', () => {
  const managedAttributes = {
    src: '/api/storage/submission-images?object_id=11111111-1111-4111-8111-111111111111',
    alt: 'My experiment',
    title: 'Photo evidence',
    width: 480,
    managed_object_id: '11111111-1111-4111-8111-111111111111',
    storage_bucket: 'submission-images',
    storage_path: 'student-1/assignment-1/evidence.png',
  }

  it('preserves managed identity, storage reference and display attrs in nested JSON → HTML → JSON', () => {
    const original = createEditor({
      type: 'doc',
      content: [{
        type: 'blockquote',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Work in progress' }] },
          { type: 'image', attrs: managedAttributes },
        ],
      }],
    })

    const html = original.getHTML()
    const pasted = createEditor(html)

    expect(pasted.getJSON().content?.[0]?.type).toBe('blockquote')
    expect(pasted.getText().trim()).toBe('Work in progress')
    expect(imageAttributes(pasted)).toMatchObject(managedAttributes)
    expect(html).toContain('data-managed-object-id=')
    expect(html).toContain('data-storage-bucket="submission-images"')
    expect(html).toContain('data-storage-path="student-1/assignment-1/evidence.png"')
  })

  it('preserves metadata from a fresh image insertion while rendering the protected URL', () => {
    const editor = createEditor()
    editor.commands.insertContent({
      type: 'image',
      attrs: { ...managedAttributes, src: 'https://storage.example/private-upload.png' },
    })

    const html = editor.getHTML()
    const pasted = createEditor(html)

    expect(imageAttributes(editor).src).toBe('https://storage.example/private-upload.png')
    expect(imageAttributes(pasted)).toMatchObject(managedAttributes)
    expect(html).not.toContain('https://storage.example/private-upload.png')
  })

  it('preserves a storage reference without an object id and escapes metadata safely', () => {
    const storagePath = 'student-1/assignment-1/evidence & "notes".png'
    const editor = createEditor({
      type: 'doc',
      content: [{
        type: 'image',
        attrs: {
          src: 'https://storage.example/evidence.png',
          storage_bucket: 'submission-images',
          storage_path: storagePath,
        },
      }],
    })

    const html = editor.getHTML()
    const pasted = createEditor(html)

    expect(imageAttributes(pasted)).toMatchObject({
      managed_object_id: null,
      storage_bucket: 'submission-images',
      storage_path: storagePath,
      src: `/api/storage/submission-images?path=${encodeURIComponent(storagePath)}`,
    })
    expect(html).toContain('evidence &amp; &quot;notes&quot;.png')
  })

  it.each([null, undefined])('leaves ordinary external images unchanged with %s metadata', (missing) => {
    const attributes = {
      src: 'https://example.com/diagram.png?size=large&mode=full',
      alt: 'Diagram',
      title: 'An external diagram',
      width: 320,
      managed_object_id: missing,
      storage_bucket: missing,
      storage_path: missing,
    }
    const editor = createEditor({ type: 'doc', content: [{ type: 'image', attrs: attributes }] })

    const html = editor.getHTML()
    const pasted = createEditor(html)

    expect(imageAttributes(pasted)).toMatchObject({
      ...attributes,
      managed_object_id: null,
      storage_bucket: null,
      storage_path: null,
    })
    expect(html).not.toMatch(/data-(?:managed-object-id|storage-bucket|storage-path)=/)
    expect(html).not.toMatch(/="(?:null|undefined)"/)
    expect(html).not.toContain('storage_bucket=')
    expect(html).not.toContain('storage_path=')
  })
})
