import { ClipboardList, FileText, ListChecks } from 'lucide-react'

export type ClassworkType = 'assignment' | 'material' | 'survey'

/** Keep creation menus and existing Classwork items visually identifiable. */
export function ClassworkTypeIcon({ type, className = 'h-4 w-4 shrink-0' }: {
  type: ClassworkType
  className?: string
}) {
  const Icon = { assignment: ClipboardList, material: FileText, survey: ListChecks }[type]
  return <Icon className={className} aria-hidden="true" />
}
