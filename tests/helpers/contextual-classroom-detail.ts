import { createClient } from '@supabase/supabase-js'
import { vi } from 'vitest'
import type { Database } from '@/types/database'

export const actorId = '11111111-1111-4111-8111-111111111111'
export const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
export const timestamp = '2026-10-03T12:00:00.123456+00:00'
export const classroom = {
  id: classroomId, teacher_id: actorId, title: 'Class', class_code: 'ABC', term_label: null,
  allow_enrollment: true, join_policy: 'roster', archived_at: null, created_at: timestamp,
  updated_at: timestamp, start_date: '2026-09-01', end_date: null, position: 2,
  theme_color: 'historical', lesson_plan_visibility: 'all', blueprint_source_revision: 3,
  source_blueprint_id: otherId, source_blueprint_origin: { historical: ['source', null] },
  source_blueprint_version_id: otherId, authoring_guidance_version_id: otherId,
  actual_site_slug: null, actual_site_published: false, actual_site_config: { overview: false },
  feature_visibility: { syllabus: false }, course_overview_markdown: 'Private overview draft',
  course_outline_markdown: 'Private outline draft', manual_attendance_revision: 4,
  manual_attendance_session_starts_local: '09:00:00', manual_attendance_session_ends_local: '10:00:00',
  manual_attendance_source_mode: 'manual',
}
export const membership = { classroom_id: classroomId, student_id: actorId }
export const preflight = (row = classroom) => ({ id: row.id, teacher_id: row.teacher_id, archived_at: row.archived_at })

/** The real installed SDK encodes every predicate; fetch is isolated from the network. */
export function detailFixture(responses: unknown[]) {
  const urls: URL[] = []
  const queue = [...responses]
  const fetch = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
    urls.push(new URL(String(url)))
    const value = queue.shift()
    if (value instanceof Error) throw value
    if (value instanceof Response) return value
    const isSingle = new Headers(options?.headers).get('Accept') === 'application/vnd.pgrst.object+json'
    return new Response(JSON.stringify(isSingle ? value : value === null ? [] : [value]), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  })
  const supabase = createClient<Database>('http://localhost:54321', 'unit-test-key', {
    global: { fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return { supabase, urls, fetch }
}
