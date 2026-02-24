import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { createClassroomSchema } from '@/lib/validations/teacher'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Generate a random 6-character alphanumeric class code
function generateClassCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Exclude ambiguous chars
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

// GET /api/teacher/classrooms - List teacher's classrooms
export const GET = withErrorHandler('GetTeacherClassrooms', async (request: NextRequest) => {
  const user = await requireRole('teacher')
  const supabase = getServiceRoleClient()
  const { searchParams } = new URL(request.url)
  const archivedParam = searchParams.get('archived')

  let query = supabase
    .from('classrooms')
    .select('*')
    .eq('teacher_id', user.id)

  if (archivedParam === 'true') {
    query = query.not('archived_at', 'is', null).order('archived_at', { ascending: false })
  } else {
    query = query.is('archived_at', null).order('updated_at', { ascending: false })
  }

  const { data: classrooms, error } = await query

  if (error) {
    console.error('Error fetching classrooms:', error)
    throw new ApiError(500, 'Failed to fetch classrooms')
  }

  return NextResponse.json({ classrooms })
})

// POST /api/teacher/classrooms - Create classroom
export const POST = withErrorHandler('CreateClassroom', async (request: NextRequest) => {
  const user = await requireRole('teacher')
  const { title, classCode, termLabel } = createClassroomSchema.parse(await request.json())

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
    throw new ApiError(500, 'Failed to create classroom')
  }

  return NextResponse.json({ classroom }, { status: 201 })
})
