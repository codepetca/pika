import { z } from 'zod'

export const classroomBlueprintMaterialsParamsSchema = z.object({ id: z.string().uuid() })

export const classroomBlueprintMaterialsSchema = z.object({
  version_id: z.string().uuid(),
  version_number: z.coerce.number().int().positive(),
  materials: z.array(z.object({
    artifact_id: z.string().uuid(),
    title: z.string().trim().min(1, 'Material title is required'),
    content_markdown: z.string(),
    position: z.number().int().nonnegative(),
  })).max(500),
})

export type ClassroomBlueprintMaterials = z.infer<typeof classroomBlueprintMaterialsSchema>

export const classroomBlueprintMaterialsResponseSchema = z.object({
  materials: classroomBlueprintMaterialsSchema.nullable(),
})
