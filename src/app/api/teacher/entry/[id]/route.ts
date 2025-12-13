import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/teacher/entry/[id]
 * Fetches a specific entry (for teacher to view)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole('teacher')

    const { id } = await params
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
  } catch (error: any) {
    // Authentication error (401)
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Authorization error (403)
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // All other errors (500)
    console.error('Get entry error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
