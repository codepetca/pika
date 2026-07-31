import { Image } from '@tiptap/extension-image'

/**
 * Keeps the managed-file identity beside the presentation URL in Tiptap JSON.
 * The server still treats both values as untrusted and validates the exact
 * object, path, and classroom before saving.
 */
export const ManagedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      managed_object_id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-managed-object-id'),
        renderHTML: (attributes) => attributes.managed_object_id
          ? { 'data-managed-object-id': attributes.managed_object_id }
          : {},
      },
    }
  },
})
