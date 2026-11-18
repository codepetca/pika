import { fetchJSONWithCache } from '@/lib/request-cache'

/** Shared by roster intent and the roster view so pending reads keep identical errors. */
export async function fetchTeacherRoster(classroomId: string) {
  const res = await fetch(`/api/teacher/classrooms/${classroomId}/roster`)
  const data = await res.json()
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      try {
        const meData = await fetchJSONWithCache('auth-me:roster-error', async () => {
          const meRes = await fetch('/api/auth/me')
          return meRes.json().catch(() => ({}))
        }, 2_000)
        const role = (meData?.user?.role ?? null) as 'student' | 'teacher' | null
        if (role && role !== 'teacher') {
          throw new Error('You are not signed in as a teacher. Log out and sign back in as a teacher (student sign-in in another tab replaces the session).')
        }
      } catch {
        // Preserve the existing generic roster error fallback.
      }
    }
    throw new Error(data.error || 'Failed to load roster')
  }
  return data
}
