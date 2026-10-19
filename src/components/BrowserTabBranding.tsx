'use client'

import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { getClassroomThemeDefinition } from '@/lib/classroom-theme'
import type { Classroom } from '@/types'

type TabClassroom = Pick<Classroom, 'id' | 'title' | 'theme_color'>
const ClassroomTabContext = createContext<Dispatch<SetStateAction<TabClassroom | null>> | null>(null)

/** Single owner for browser chrome; the classroom registers its already-authorized data. */
export function BrowserTabProvider({ children }: { children: ReactNode }) {
  const { theme, mounted } = useTheme()
  const [classroom, setClassroom] = useState<TabClassroom | null>(null)

  useEffect(() => {
    if (!mounted) return
    const color = classroom ? getClassroomThemeDefinition(classroom.theme_color) : null
    document.title = classroom ? classroom.title : 'Pika'
    // These nodes belong to the persistent root layout, outside Next's route metadata.
    document.getElementById('pika-tab-icon')?.setAttribute('href', color
      ? `/classroom-icons/${color.value}`
      : `/pika-icon-${theme}.svg`)
    document.getElementById('pika-tab-color')?.setAttribute('content', color
      ? theme === 'dark' ? color.darkColor : color.color
      : theme === 'dark' ? '#030712' : '#f9fafb')
  }, [classroom, mounted, theme])

  return <ClassroomTabContext.Provider value={setClassroom}>{children}</ClassroomTabContext.Provider>
}

export function ClassroomTabBranding({ classroom }: { classroom: TabClassroom }) {
  const setClassroom = useContext(ClassroomTabContext)
  const { id, title, theme_color } = classroom
  useEffect(() => {
    if (!setClassroom) return
    setClassroom({ id, title, theme_color })
    return () => setClassroom(null)
  }, [id, title, theme_color, setClassroom])
  return null
}
