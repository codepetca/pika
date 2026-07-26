import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const mergeTailwindClasses = extendTailwindMerge({
  extend: {
    classGroups: {
      'ring-w': [{ ring: ['foundation'] }],
      'ring-offset-w': [{ 'ring-offset': ['foundation'] }],
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
