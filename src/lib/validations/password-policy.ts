// bcrypt's input limit is bytes, not UTF-16 string length. Keep this browser-safe.
export const MAX_PASSWORD_UTF8_BYTES = 72
export const PASSWORD_BYTE_LIMIT_MESSAGE = 'Password must be at most 72 UTF-8 bytes (some characters use more than one byte)'
export function isSupportedNewPassword(password: string): boolean {
  return new TextEncoder().encode(password).byteLength <= MAX_PASSWORD_UTF8_BYTES
}
