/**
 * Shared constants and utilities for image upload functionality
 */

/** Allowed MIME types for image uploads */
export const IMAGE_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** Maximum file size for image uploads (10MB) */
export const IMAGE_MAX_SIZE = 10 * 1024 * 1024

/** Human-readable max size for error messages */
export const IMAGE_MAX_SIZE_MB = 10

/** Accept string for file inputs */
export const IMAGE_ACCEPT = 'image/*'

/**
 * Validate that a file is an allowed image type
 */
export function isAllowedImageType(mimeType: string): boolean {
  return IMAGE_ALLOWED_TYPES.includes(mimeType)
}

/**
 * Validate that a file is within the size limit
 */
export function isWithinSizeLimit(size: number): boolean {
  return size <= IMAGE_MAX_SIZE
}

/**
 * Get a human-readable error message for file validation
 */
export function getImageValidationError(file: File): string | null {
  if (!isAllowedImageType(file.type)) {
    return 'Invalid file type. Allowed: PNG, JPEG, GIF, WebP'
  }
  if (!isWithinSizeLimit(file.size)) {
    return `File too large. Maximum size is ${IMAGE_MAX_SIZE_MB}MB`
  }
  return null
}
