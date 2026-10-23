'use client'

import { Eye, EyeOff } from 'lucide-react'
import { IconButton } from '@/ui'
import { ClassroomRowFrame } from '@/components/SortableClassroomRow'
import { getClassroomThemeStyle } from '@/lib/classroom-theme'
import type { ClassroomHomePresentation } from '@/lib/contracts/classroom-home'

type Item = ClassroomHomePresentation['joined'][number]

export function JoinedHomeClassrooms({ rows, hidden, editing, busy, onOpen, onVisibility }: {
  rows: Item[]; hidden: boolean; editing: boolean; busy: boolean
  onOpen: (id: string) => void; onVisibility: (row: Item, hidden: boolean) => void
}) {
  if (!rows.length && !hidden) return null
  return <section aria-label={`${hidden ? 'Hidden' : 'Joined'} classrooms`} className="mt-5">
    <h2 className="mb-2 text-xs font-medium text-text-muted">{hidden ? 'Hidden' : 'Joined'}</h2>
    {hidden && <p className="mb-3 text-xs text-text-muted">Joined classrooms hidden from your active list. You’re still a member.</p>}
    {!rows.length && <p className="text-sm text-text-muted">No hidden classrooms</p>}
    <div className="space-y-2">{rows.map(row => <div key={row.enrollment_id}
      data-testid="joined-classroom-card" data-classroom-theme-color={row.theme_color}
      style={getClassroomThemeStyle(row.theme_color)}
      className="classroom-theme classroom-theme-card classroom-theme-card-interactive relative rounded-card bg-surface shadow-elevated focus-within:z-local-menu">
      <ClassroomRowFrame classroom={row} dragHandle={null} onOpen={() => onOpen(row.id)} isDisabled={busy} action={
        hidden || editing ? <IconButton icon={hidden ? Eye : EyeOff} label={`${hidden ? 'Unhide' : 'Hide'} ${row.title}`}
          variant="ghost" disabled={busy} onClick={() => onVisibility(row, !hidden)} /> : null
      } />
    </div>)}</div>
  </section>
}
