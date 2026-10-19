'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AppHeader } from '@/components/AppHeader'
import { ClassroomTabBranding } from '@/components/BrowserTabBranding'
import { useTheme } from '@/contexts/ThemeContext'
import { Button } from '@/ui'
import type { ClassroomThemeColor } from '@/lib/classroom-theme'

const CLASSROOMS = [
  { id: 'health', title: 'PPZ3C — Health for Life', theme_color: 'rose' as ClassroomThemeColor },
  { id: 'computing', title: 'ICS4U — Computer Science', theme_color: 'violet' as ClassroomThemeColor },
]

export function BrowserTabBrandingFixture({ userRole: role }: { userRole: 'teacher' | 'student' }) {
  const [classroom, setClassroom] = useState<typeof CLASSROOMS[number] | null>(CLASSROOMS[0])
  const { toggleTheme } = useTheme()
  return (
    <>
      {classroom ? <ClassroomTabBranding classroom={classroom} /> : null}
      <AppHeader
        initialNow={Date.parse('2026-10-19T16:00:00Z')}
        user={{ email: `${role}@example.invalid`, role }}
        classrooms={CLASSROOMS.map((item) => ({ id: item.id, title: item.title, code: item.id, themeColor: item.theme_color }))}
        currentClassroomId={classroom?.id}
        pageTitle={classroom ? undefined : 'Classrooms'}
      />
      <main className="space-y-4 p-6 text-text-default">
        <h1>Browser tab branding fixture</h1>
        <p>{role} · {classroom?.title ?? 'Home'}</p>
        <div className="flex flex-wrap gap-3">
          {CLASSROOMS.map((item, index) => <Button key={item.id} onClick={() => setClassroom(item)}>Classroom {index + 1}</Button>)}
          <Button onClick={() => setClassroom(null)}>Home</Button>
          <Button onClick={() => setClassroom((current) => current ? { ...current, title: 'Renamed classroom', theme_color: 'teal' } : current)}>Edit classroom</Button>
          <Button onClick={toggleTheme}>Toggle theme</Button>
          <Link href={`?userRole=${role === 'teacher' ? 'student' : 'teacher'}`} className="text-primary">Switch role route</Link>
          <Link href="/login" className="text-primary">Leave classroom</Link>
        </div>
      </main>
    </>
  )
}
