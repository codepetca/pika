import {
  Calendar,
  ClipboardCheck,
  ClipboardList,
  Compass,
  Megaphone,
  Settings,
  SquarePen,
  SquarePercent,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { ClassroomTabId } from '@/lib/classroom-feature-visibility'

export type ClassroomNavRole = 'student' | 'teacher'

export interface ClassroomNavCatalogItem {
  id: ClassroomTabId
  label: string
  icon: LucideIcon
  lucideName: string
  roles: readonly ClassroomNavRole[]
}

export const CLASSROOM_NAV_ITEMS: readonly ClassroomNavCatalogItem[] = [
  { id: 'daily', label: 'Daily', icon: ClipboardCheck, lucideName: 'ClipboardCheck', roles: ['teacher'] },
  { id: 'today', label: 'Daily', icon: ClipboardCheck, lucideName: 'ClipboardCheck', roles: ['student'] },
  { id: 'assignments', label: 'Classwork', icon: ClipboardList, lucideName: 'ClipboardList', roles: ['teacher', 'student'] },
  { id: 'tests', label: 'Tests', icon: SquarePen, lucideName: 'SquarePen', roles: ['teacher', 'student'] },
  { id: 'gradebook', label: 'Gradebook', icon: SquarePercent, lucideName: 'SquarePercent', roles: ['teacher'] },
  { id: 'calendar', label: 'Calendar', icon: Calendar, lucideName: 'Calendar', roles: ['teacher', 'student'] },
  { id: 'resources', label: 'Course Guide', icon: Compass, lucideName: 'Compass', roles: ['teacher', 'student'] },
  { id: 'announcements', label: 'Announcements', icon: Megaphone, lucideName: 'Megaphone', roles: ['teacher', 'student'] },
  { id: 'roster', label: 'Roster', icon: Users, lucideName: 'Users', roles: ['teacher'] },
  { id: 'settings', label: 'Settings', icon: Settings, lucideName: 'Settings', roles: ['teacher'] },
  { id: 'achievements', label: 'Achievements', icon: Trophy, lucideName: 'Trophy', roles: ['student'] },
]
