import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import type { TAConfig } from '@/lib/teachassist/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function assertTeacherOwnsClassroom(teacherId: string, classroomId: string) {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase
    .from('classrooms')
    .select('id, teacher_id')
    .eq('id', classroomId)
    .single()

  if (error || !data) return { ok: false as const, status: 404 as const, error: 'Classroom not found' }
  if (data.teacher_id !== teacherId) return { ok: false as const, status: 403 as const, error: 'Forbidden' }
  return { ok: true as const }
}

/**
 * GET /api/teacher/teachassist/config?classroom_id=xxx
 *
 * Returns the TeachAssist configuration for a classroom (without the password).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireRole('teacher')
    const classroomId = request.nextUrl.searchParams.get('classroom_id')?.trim()

    if (!classroomId) {
      return NextResponse.json({ error: 'classroom_id is required' }, { status: 400 })
    }

    const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    const supabase = getServiceRoleClient()
    const { data } = await supabase
      .from('teachassist_mappings')
      .select('config, created_at, updated_at')
      .eq('classroom_id', classroomId)
      .single()

    if (!data?.config) {
      return NextResponse.json({ config: null }, { status: 200 })
    }

    // Return config without the encrypted password
    const config = data.config as TAConfig
    return NextResponse.json({
      config: {
        ta_username: config.ta_username,
        ta_base_url: config.ta_base_url,
        ta_course_search: config.ta_course_search,
        ta_block: config.ta_block,
        ta_execution_mode: config.ta_execution_mode || 'confirmation',
        has_password: !!config.ta_password_encrypted,
      },
      created_at: data.created_at,
      updated_at: data.updated_at,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.error('Get TeachAssist config error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/teacher/teachassist/config
 *
 * Save TeachAssist configuration for a classroom.
 *
 * Body:
 *   classroom_id: string (required)
 *   ta_username: string (required)
 *   ta_password: string (optional if updating — omit to keep existing password)
 *   ta_base_url: string (default: "https://ta.yrdsb.ca/yrdsb/")
 *   ta_course_search: string (required — e.g. "GLD2OOH")
 *   ta_block: string (required — e.g. "A1")
 *   ta_execution_mode: 'confirmation' | 'full_auto' (default: "confirmation")
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireRole('teacher')
    const body = await request.json()

    const classroomId = String(body.classroom_id || '').trim()
    if (!classroomId) {
      return NextResponse.json({ error: 'classroom_id is required' }, { status: 400 })
    }

    const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    // Validate required fields
    const username = String(body.ta_username || '').trim()
    const password = String(body.ta_password || '').trim()
    const courseSearch = String(body.ta_course_search || '').trim()
    const block = String(body.ta_block || '').trim()
    const baseUrl = String(body.ta_base_url || 'https://ta.yrdsb.ca/yrdsb/').trim()
    const executionMode = body.ta_execution_mode === 'full_auto' ? 'full_auto' : 'confirmation'

    if (!username || !courseSearch || !block) {
      return NextResponse.json(
        { error: 'ta_username, ta_course_search, and ta_block are required' },
        { status: 400 }
      )
    }

    // Resolve password: use new password if provided, otherwise keep existing
    const supabase = getServiceRoleClient()
    let resolvedPassword = password

    if (!resolvedPassword) {
      const { data: existing } = await supabase
        .from('teachassist_mappings')
        .select('config')
        .eq('classroom_id', classroomId)
        .single()

      const existingConfig = existing?.config as TAConfig | undefined
      if (existingConfig?.ta_password_encrypted) {
        resolvedPassword = existingConfig.ta_password_encrypted
      } else {
        return NextResponse.json(
          { error: 'ta_password is required for initial configuration' },
          { status: 400 }
        )
      }
    }

    // TODO: Encrypt password with AES-256-GCM using TEACHASSIST_ENCRYPTION_KEY
    // For now, store as plaintext during development
    const config: TAConfig = {
      ta_username: username,
      ta_password_encrypted: resolvedPassword,
      ta_base_url: baseUrl,
      ta_course_search: courseSearch,
      ta_block: block,
      ta_execution_mode: executionMode,
    }

    const { error } = await supabase
      .from('teachassist_mappings')
      .upsert(
        {
          classroom_id: classroomId,
          config,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'classroom_id' }
      )

    if (error) {
      console.error('Save TeachAssist config error:', error)
      return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.error('Save TeachAssist config error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
