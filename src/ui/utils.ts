import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Utility for merging class names with Tailwind CSS support.
 * Uses clsx for conditional classes and tailwind-merge to handle conflicts.
 *
 * @example
 * cn('px-4 py-2', isPrimary && 'bg-blue-500', className)
 * cn('text-red-500', 'text-blue-500') // => 'text-blue-500' (tailwind-merge resolves conflict)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
