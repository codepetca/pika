import { Node } from '@tiptap/core'

/**
 * Read-only counterpart to the student editor's interactive imageUpload node.
 *
 * An unfinished upload can be autosaved before the student chooses a file. The
 * viewer must recognize that persisted node or Tiptap rejects the whole
 * document, including otherwise valid text around it.
 */
export const ReadOnlyImageUpload = Node.create({
  name: 'imageUpload',
  group: 'block',
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      accept: { default: 'image/*', rendered: false },
      limit: { default: 1, rendered: false },
      maxSize: { default: 0, rendered: false },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="image-upload"]' }]
  },

  renderHTML() {
    return [
      'div',
      {
        'data-type': 'image-upload',
        'data-read-only': 'true',
        role: 'note',
        class: 'rounded-lg border border-dashed border-border bg-surface-2 px-4 py-3 text-sm text-text-muted',
      },
      'Image upload was not completed',
    ]
  },
})
