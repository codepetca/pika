'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { Classroom } from '@/types'

type Role = 'teacher' | 'student'

interface Props {
  role: Role
}

export function UiGallery({ role }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const [classrooms, setClassrooms] = useState<Classroom[]>([])

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError('')
      try {
        const url = role === 'teacher'
          ? '/api/teacher/classrooms'
          : '/api/student/classrooms'
        const res = await fetch(url)
        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error || 'Failed to load classrooms')
        }

        const next = role === 'teacher'
          ? (data.classrooms || [])
          : (data.classrooms || [])
        setClassrooms(next)
      } catch (err: any) {
        setError(err.message || 'Failed to load')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [role])

  const teacherLinks = useMemo(() => {
    return classrooms.map((c) => ({
      id: c.id,
      title: c.title,
      links: [
        { label: 'Attendance', href: `/classrooms/${c.id}?tab=attendance` },
        { label: 'Logs', href: `/classrooms/${c.id}?tab=logs` },
        { label: 'Assignments', href: `/classrooms/${c.id}?tab=assignments` },
        { label: 'Roster', href: `/classrooms/${c.id}?tab=roster` },
        { label: 'Calendar', href: `/classrooms/${c.id}?tab=calendar` },
        { label: 'Settings', href: `/classrooms/${c.id}?tab=settings` },
      ],
    }))
  }, [classrooms])

  const studentLinks = useMemo(() => {
    return classrooms.map((c) => ({
      id: c.id,
      title: c.title,
      links: [
        { label: 'Today', href: `/classrooms/${c.id}?tab=today` },
        { label: 'Assignments', href: `/classrooms/${c.id}?tab=assignments` },
      ],
    }))
  }, [classrooms])

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-text-default">UI Gallery</h1>
        <p className="text-text-muted mt-1">
          Quick links to key views for visual review (spacing, layout, UI flow).
        </p>
      </div>

      <div className="bg-surface rounded-lg shadow-sm p-4">
        <h2 className="text-lg font-semibold text-text-default">Common</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link className="px-3 py-2 rounded-md border border-border text-sm hover:bg-surface-hover" href="/classrooms">
            Classrooms
          </Link>
          <Link className="px-3 py-2 rounded-md border border-border text-sm hover:bg-surface-hover" href="/join">
            Join (student)
          </Link>
          <Link className="px-3 py-2 rounded-md border border-border text-sm hover:bg-surface-hover" href="/logout">
            Logout
          </Link>
        </div>
      </div>

      <div className="bg-surface rounded-lg shadow-sm p-4">
        <h2 className="text-lg font-semibold text-text-default">Logged-out (open in a private window)</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link className="px-3 py-2 rounded-md border border-border text-sm hover:bg-surface-hover" href="/login">
            Login
          </Link>
          <Link className="px-3 py-2 rounded-md border border-border text-sm hover:bg-surface-hover" href="/signup">
            Signup
          </Link>
          <Link className="px-3 py-2 rounded-md border border-border text-sm hover:bg-surface-hover" href="/forgot-password">
            Forgot password
          </Link>
        </div>
      </div>

      <div className="bg-surface rounded-lg shadow-sm p-4">
        <h2 className="text-lg font-semibold text-text-default">
          {role === 'teacher' ? 'Teacher' : 'Student'} Views
        </h2>

        {loading ? (
          <div className="mt-3 text-sm text-text-muted">Loading…</div>
        ) : error ? (
          <div className="mt-3 text-sm text-danger">{error}</div>
        ) : classrooms.length === 0 ? (
          <div className="mt-3 text-sm text-text-muted">No classrooms found.</div>
        ) : (
          <div className="mt-4 space-y-4">
            {(role === 'teacher' ? teacherLinks : studentLinks).map((group) => (
              <div key={group.id} className="border border-border rounded-lg p-4">
                <div className="text-sm font-semibold text-text-default">{group.title}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {group.links.map((l) => (
                    <Link
                      key={l.href}
                      className="px-3 py-2 rounded-md border border-border text-sm hover:bg-surface-hover"
                      href={l.href}
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
