import type { CourseBlueprintAuthoringGuidance } from '@/lib/course-blueprint-authoring-guidance'

export type CourseBlueprintGuidanceRevision = {
  id: string
  content_revision: number
  source_kind: 'direct' | 'package' | 'proposal' | 'import'
  created_at: string
  guidance: CourseBlueprintAuthoringGuidance
}
