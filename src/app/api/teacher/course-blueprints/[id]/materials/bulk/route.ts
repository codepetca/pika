import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { syncCourseBlueprintMaterials } from '@/lib/server/course-blueprints'
import { courseBlueprintMaterialsBulkSchema } from '@/lib/validations/course-blueprints'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler(
  'PostTeacherCourseBlueprintMaterialsBulk',
  async (request, context) => {
    const user = await requireRole('teacher')
    const { id } = await context.params
    const body = courseBlueprintMaterialsBulkSchema.parse(await request.json())
    const result = await syncCourseBlueprintMaterials(user.id, id, body.materials)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ success: true })
  },
)
