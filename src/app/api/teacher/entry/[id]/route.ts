import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/teacher/entry/[id]
 * Fetches a specific entry (for teacher to view)
 */
export const GET = withErrorHandler('GetTeacherEntry', async (_request, context) => {
  await requireRole('teacher')

  const { id } = await context.params
  const supabase = getServiceRoleClient()

  const { data: entry, error } = await supabase
    .from('entries')
    .select(`
      *,
      student:users!student_id(email)
    `)
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json(
        { error: 'Entry not found' },
        { status: 404 }
      )
    }

    console.error('Error fetching entry:', error)
    return NextResponse.json(
      { error: 'Failed to fetch entry' },
      { status: 500 }
    )
  }

  return NextResponse.json({ entry })
})
