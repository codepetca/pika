import { Image } from '@tiptap/extension-image'
import { mergeAttributes } from '@tiptap/core'
import { getProtectedSubmissionImageUrl } from '@/lib/managed-storage-urls'

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
      storage_bucket: {
        default: null,
        rendered: false,
      },
      storage_path: {
        default: null,
        rendered: false,
      },
    }
  },

  renderHTML({ node, HTMLAttributes }) {
    const protectedSrc = getProtectedSubmissionImageUrl({
      managed_object_id: node.attrs.managed_object_id,
      storage_bucket: node.attrs.storage_bucket,
      storage_path: node.attrs.storage_path,
      src: node.attrs.src,
    })

    return [
      'img',
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        protectedSrc ? { src: protectedSrc } : {},
      ),
    ]
  },
})
