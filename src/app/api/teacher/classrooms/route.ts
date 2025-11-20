import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// GET /api/teacher/classrooms - List teacher's classrooms
export async function GET() {
  try {
    const user = await requireRole('teacher')
    const supabase = getServiceRoleClient()

    const { data: classrooms, error } = await supabase
      .from('classrooms')
      .select('*')
      .eq('teacher_id', user.id)
      .order('updated_at', { ascending: false })

    if (error) {
      console.error('Error fetching classrooms:', error)
      return NextResponse.json(
        { error: 'Failed to fetch classrooms' },
        { status: 500 }
      )
    }

    return NextResponse.json({ classrooms })
  } catch (error: any) {
    console.error('Get classrooms error:', error)
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 401 }
    )
  }
}

// Generate a random 6-character alphanumeric class code
function generateClassCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Exclude ambiguous chars
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

// POST /api/teacher/classrooms - Create classroom
export async function POST(request: NextRequest) {
  try {
    const user = await requireRole('teacher')
    const body = await request.json()
    const { title, classCode, termLabel } = body

    if (!title) {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

    // Generate class code if not provided
    const finalClassCode = classCode || generateClassCode()

    const { data: classroom, error } = await supabase
      .from('classrooms')
      .insert({
        teacher_id: user.id,
        title,
        class_code: finalClassCode,
        term_label: termLabel || null,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating classroom:', error)
      return NextResponse.json(
        { error: 'Failed to create classroom' },
        { status: 500 }
      )
    }

    return NextResponse.json({ classroom }, { status: 201 })
  } catch (error: any) {
    console.error('Create classroom error:', error)
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 401 }
    )
  }
}
