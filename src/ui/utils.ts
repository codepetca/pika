import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const mergeTailwindClasses = extendTailwindMerge({
  extend: {
    classGroups: {
      duration: [{ duration: ['fast', 'standard', 'deliberate'] }],
      ease: [{ ease: ['standard'] }],
      'max-w': [{ 'max-w': ['reading', 'standard', 'wide'] }],
      'min-h': [{ 'min-h': ['control'] }],
      'min-w': [{ 'min-w': ['control'] }],
      mx: [{ mx: ['density-compact-gutter', 'density-comfortable-gutter'] }],
      pt: [{
        pt: [
          'density-compact-content-top',
          'density-comfortable-content-top',
        ],
      }],
      px: [{ px: ['density-compact-gutter', 'density-comfortable-gutter'] }],
      'ring-w': [{ ring: ['foundation'] }],
      'ring-offset-w': [{ 'ring-offset': ['foundation'] }],
      'space-y': [{
        'space-y': [
          'density-compact-stack-gap',
          'density-comfortable-stack-gap',
        ],
      }],
      z: [{
        z: [
          'local-menu',
          'floating',
          'app-chrome',
          'popover',
          'modal',
          'app-message',
        ],
      }],
    },
  },
})

/**
 * Utility for merging class names with Tailwind CSS support.
 * Uses clsx for conditional classes and tailwind-merge to handle conflicts.
 *
 * @example
 * cn('px-4 py-2', isPrimary && 'bg-primary-solid', className)
 * cn('text-text-muted', 'text-text-default') // => 'text-text-default'
 */
export function cn(...inputs: ClassValue[]): string {
  return mergeTailwindClasses(clsx(inputs))
}
