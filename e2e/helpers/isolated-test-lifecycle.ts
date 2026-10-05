import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { hashPassword } from '../../src/lib/crypto'
import type { Database } from '../../src/types/database'

// Called only at test runtime. Collection must never connect to or mutate a DB.
export async function createIsolatedLifecycleFixture() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (process.env.PIKA_E2E_LIFECYCLE_FIXTURES !== 'true' || !url || !key) {
    throw new Error('Lifecycle tests require explicit local fixture opt-in and Supabase credentials')
  }
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) {
    throw new Error('Lifecycle fixtures require a loopback Supabase endpoint')
  }
  const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const teacherId = randomUUID(), studentId = randomUUID(), classroomId = randomUUID()
  const tag = randomUUID().replaceAll('-', '').slice(0, 12)
  const teacherEmail = `lifecycle-teacher-${tag}@example.test`
  const studentEmail = `lifecycle-student-${tag}@example.test`
  const classroomTitle = `Isolated lifecycle ${tag}`
  const password = `Lifecycle-${randomUUID()}`
  let ownsUsers = false, ownsClassroom = false
  async function cleanup() {
    if (ownsClassroom) {
      const { data, error } = await db.from('classrooms').select('id, teacher_id, title').eq('id', classroomId).maybeSingle()
      if (error || (data && (data.teacher_id !== teacherId || data.title !== classroomTitle))) throw new Error('Lifecycle fixture Classroom ownership could not be verified')
      if (data) {
        const { error: deletionError } = await db.from('classrooms').delete().eq('id', classroomId).eq('teacher_id', teacherId)
        if (deletionError) throw new Error('Lifecycle fixture Classroom teardown failed')
      }
      const { count, error: residueError } = await db.from('tests').select('id', { head: true, count: 'exact' }).eq('classroom_id', classroomId)
      if (residueError || count !== 0) throw new Error('Lifecycle fixture Test residue remains')
    }
    if (ownsUsers) {
      for (const [id, email] of [[teacherId, teacherEmail], [studentId, studentEmail]]) {
        const { error } = await db.from('users').delete().eq('id', id).eq('email', email)
        if (error) throw new Error('Lifecycle fixture account teardown failed')
      }
      const { count, error } = await db.from('users').select('id', { head: true, count: 'exact' }).in('id', [teacherId, studentId])
      if (error || count !== 0) throw new Error('Lifecycle fixture account residue remains')
    }
  }
  try {
    // Random UUID ownership is still checked before any insert; never upsert shared auth.
    const { count, error: collisionError } = await db.from('users').select('id', { head: true, count: 'exact' }).in('id', [teacherId, studentId])
    if (collisionError || count !== 0) throw new Error('Lifecycle fixture IDs are unavailable')
    const { data: existing, error: classroomCollisionError } = await db.from('classrooms').select('id').eq('id', classroomId).maybeSingle()
    if (classroomCollisionError || existing) throw new Error('Lifecycle fixture Classroom ID is unavailable')
    const passwordHash = await hashPassword(password)
    ownsUsers = true // Covers an uncertain successful insert response as well.
    const { error: userError } = await db.from('users').insert([
      { id: teacherId, email: teacherEmail, role: 'teacher', password_hash: passwordHash },
      { id: studentId, email: studentEmail, role: 'student', password_hash: passwordHash },
    ])
    if (userError) throw new Error('Lifecycle fixture account creation failed')
    ownsClassroom = true
    const { error: classroomError } = await db.from('classrooms').insert({ id: classroomId, teacher_id: teacherId, title: classroomTitle, class_code: tag.slice(0, 8).toUpperCase() })
    if (classroomError) throw new Error('Lifecycle fixture Classroom creation failed')
    const { error: enrollmentError } = await db.from('classroom_enrollments').insert({ classroom_id: classroomId, student_id: studentId })
    if (enrollmentError) throw new Error('Lifecycle fixture enrollment failed')
    return { teacherId, studentId, classroomId, classroomTitle, teacherEmail, studentEmail, password, cleanup }
  } catch (error) {
    try { await cleanup() } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Lifecycle fixture setup and cleanup failed') }
    throw error
  }
}
