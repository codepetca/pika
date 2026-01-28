import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Capitalize a string (first letter uppercase, rest lowercase).
 */
function capitalize(str: string): string {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}

/**
 * Parse a teacher's email to extract first and last name.
 *
 * Examples:
 * - john.smith@yrdsb.ca → { first_name: 'John', last_name: 'Smith' }
 * - john.piper.smith@yrdsb.ca → { first_name: 'John', last_name: 'Smith' }
 * - admin@yrdsb.ca → { first_name: 'Admin', last_name: null }
 */
export function parseTeacherEmail(email: string): {
  first_name: string | null
  last_name: string | null
} {
  const localPart = email.split('@')[0]
  if (!localPart) {
    return { first_name: null, last_name: null }
  }

  const parts = localPart.split('.')

  if (parts.length === 0) {
    return { first_name: null, last_name: null }
  }

  if (parts.length === 1) {
    return { first_name: capitalize(parts[0]), last_name: null }
  }

  // Multiple parts: take first and last
  return {
    first_name: capitalize(parts[0]),
    last_name: capitalize(parts[parts.length - 1]),
  }
}

/**
 * Get user display info (first_name, last_name) for avatar rendering.
 *
 * For teachers: parses the email address.
 * For students: queries the student_profiles table.
 *
 * Returns nulls if data is unavailable (graceful fallback).
 */
export async function getUserDisplayInfo(
  user: { id: string; email: string; role: 'student' | 'teacher' },
  supabase: SupabaseClient
): Promise<{ first_name: string | null; last_name: string | null }> {
  if (user.role === 'teacher') {
    return parseTeacherEmail(user.email)
  }

  // Student: query student_profiles table
  try {
    const { data: profile } = await supabase
      .from('student_profiles')
      .select('first_name, last_name')
      .eq('user_id', user.id)
      .single()

    if (profile) {
      return {
        first_name: profile.first_name,
        last_name: profile.last_name,
      }
    }
  } catch {
    // Query failed, gracefully fall back to nulls
  }

  return { first_name: null, last_name: null }
}
