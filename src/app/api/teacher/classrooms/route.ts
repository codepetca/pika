import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { createClassroomSchema } from '@/lib/validations/teacher'
import { getNextTeacherClassroomPosition, listActiveTeacherClassrooms } from '@/lib/server/classroom-order'
import { hydrateClassroomRecord, hydrateClassroomRecords } from '@/lib/server/classrooms'
import { listTeacherColdClassroomArchives } from '@/lib/server/classroom-archive-recovery-list'
import { getLeastUsedClassroomThemeColor } from '@/lib/classroom-theme'

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

  if (archivedParam === 'true') {
    const [hotResult, coldResult] = await Promise.all([
      supabase
        .from('classrooms')
        .select('*')
        .eq('teacher_id', user.id)
        .not('archived_at', 'is', null)
        .order('archived_at', { ascending: false }),
      listTeacherColdClassroomArchives({ supabase, teacherId: user.id }),
    ])

    if (hotResult.error) {
      console.error('Error fetching archived classrooms:', hotResult.error)
      throw new ApiError(500, 'Failed to fetch classrooms')
    }
    if (!coldResult.ok) {
      console.error('Error fetching cold classroom archives:', coldResult.error_code)
      throw new ApiError(500, 'Failed to fetch classroom archives')
    }

    return NextResponse.json({
      classrooms: hydrateClassroomRecords((hotResult.data || []) as Record<string, any>[]),
      cold_archives: coldResult.cold_archives,
      cold_archive_restore_enabled: coldResult.cold_archive_restore_enabled,
    })
  }

  const { data: classrooms, error } = await listActiveTeacherClassrooms(supabase, user.id)
  if (error) {
    console.error('Error fetching classrooms:', error)
    throw new ApiError(500, 'Failed to fetch classrooms')
  }

  return NextResponse.json({
    classrooms: hydrateClassroomRecords((classrooms || []) as Record<string, any>[]),
  })
})

// POST /api/teacher/classrooms - Create classroom
export const POST = withErrorHandler('CreateClassroom', async (request: NextRequest) => {
  const user = await requireRole('teacher')
  const { title, classCode, termLabel, themeColor } = createClassroomSchema.parse(await request.json())

  const supabase = getServiceRoleClient()

  const finalClassCode = classCode || generateClassCode()
  const nextPosition = await getNextTeacherClassroomPosition(supabase, user.id)
  const activeClassroomsResult = themeColor ? null : await listActiveTeacherClassrooms(supabase, user.id)
  const defaultThemeColor = getLeastUsedClassroomThemeColor(
    (activeClassroomsResult?.data || []).map((classroom: any) => classroom.theme_color),
    `${user.id}:${title}`
  )
  const insertBody: Record<string, any> = {
    teacher_id: user.id,
    title,
    class_code: finalClassCode,
    term_label: termLabel || null,
    theme_color: themeColor || defaultThemeColor,
  }

  if (nextPosition !== null) {
    insertBody.position = nextPosition
  }

  const { data: classroom, error } = await supabase
    .from('classrooms')
    .insert(insertBody)
    .select()
    .single()

  if (error) {
    console.error('Error creating classroom:', error)
    throw new ApiError(500, 'Failed to create classroom')
  }

  return NextResponse.json({ classroom: hydrateClassroomRecord(classroom as Record<string, any>) }, { status: 201 })
})
