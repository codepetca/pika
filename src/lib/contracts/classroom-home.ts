import type { ClassroomHomeItem } from '@/lib/server/contextual-classroom-home'

/** Server-resolved capabilities; the write endpoints remain authoritative. */
export type ClassroomHomePresentation = {
  joined: ClassroomHomeItem[]
  hidden: ClassroomHomeItem[]
  canCreate: boolean
  canImportBlueprint: boolean
}
