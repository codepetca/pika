import { Image } from '@tiptap/extension-image'

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
