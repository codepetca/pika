'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { AssignmentDocHistoryEntry, Classroom } from '@/types'
import { HistoryGraph } from '@/components/HistoryGraph'

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

      <HistoryGraphGallery />
    </div>
  )
}

// ── History Graph Gallery ──────────────────────────────────────────

function makeEntry(
  id: string,
  charCount: number,
  createdAt: string,
  trigger: AssignmentDocHistoryEntry['trigger'] = 'autosave'
): AssignmentDocHistoryEntry {
  return {
    id,
    assignment_doc_id: 'doc-1',
    patch: null,
    snapshot: null,
    word_count: Math.round(charCount / 5),
    char_count: charCount,
    paste_word_count: null,
    keystroke_count: null,
    trigger,
    created_at: createdAt,
  }
}

// Newest-first (as from DB)
const SCENARIOS: { label: string; entries: AssignmentDocHistoryEntry[] }[] = [
  {
    label: 'Normal session — 18 entries, all additions',
    entries: [
      makeEntry('n18', 520, '2025-01-15T19:34:00Z'),
      makeEntry('n17', 500, '2025-01-15T19:30:00Z'),
      makeEntry('n16', 475, '2025-01-15T19:26:00Z'),
      makeEntry('n15', 450, '2025-01-15T19:22:00Z'),
      makeEntry('n14', 430, '2025-01-15T19:18:00Z'),
      makeEntry('n13', 405, '2025-01-15T19:14:00Z'),
      makeEntry('n12', 385, '2025-01-15T19:10:00Z'),
      makeEntry('n11', 360, '2025-01-15T19:06:00Z'),
      makeEntry('n10', 340, '2025-01-15T19:02:00Z'),
      makeEntry('n09', 310, '2025-01-15T18:58:00Z'),
      makeEntry('n08', 285, '2025-01-15T18:54:00Z'),
      makeEntry('n07', 260, '2025-01-15T18:50:00Z'),
      makeEntry('n06', 230, '2025-01-15T18:46:00Z'),
      makeEntry('n05', 200, '2025-01-15T18:42:00Z'),
      makeEntry('n04', 165, '2025-01-15T18:38:00Z'),
      makeEntry('n03', 125, '2025-01-15T18:34:00Z'),
      makeEntry('n02', 80, '2025-01-15T18:30:00Z'),
      makeEntry('n01', 30, '2025-01-15T18:26:00Z', 'baseline'),
    ],
  },
  {
    label: 'Mixed session — additions and deletions',
    entries: [
      makeEntry('m10', 320, '2025-01-15T19:20:00Z'),
      makeEntry('m09', 280, '2025-01-15T19:16:00Z'),
      makeEntry('m08', 350, '2025-01-15T19:12:00Z'),
      makeEntry('m07', 310, '2025-01-15T19:08:00Z'),
      makeEntry('m06', 370, '2025-01-15T19:04:00Z'),
      makeEntry('m05', 340, '2025-01-15T19:00:00Z'),
      makeEntry('m04', 290, '2025-01-15T18:56:00Z'),
      makeEntry('m03', 250, '2025-01-15T18:52:00Z'),
      makeEntry('m02', 180, '2025-01-15T18:48:00Z'),
      makeEntry('m01', 100, '2025-01-15T18:44:00Z', 'baseline'),
    ],
  },
  {
    label: 'Gap — two sessions with 30-min break',
    entries: [
      makeEntry('g08', 480, '2025-01-15T20:08:00Z'),
      makeEntry('g07', 440, '2025-01-15T20:04:00Z'),
      makeEntry('g06', 400, '2025-01-15T20:00:00Z'),
      makeEntry('g05', 360, '2025-01-15T19:56:00Z'),
      // 30-min gap
      makeEntry('g04', 300, '2025-01-15T19:22:00Z'),
      makeEntry('g03', 240, '2025-01-15T19:18:00Z'),
      makeEntry('g02', 170, '2025-01-15T19:14:00Z'),
      makeEntry('g01', 100, '2025-01-15T19:10:00Z', 'baseline'),
    ],
  },
  {
    label: 'Large paste — one +500 entry (warning)',
    entries: [
      makeEntry('p05', 700, '2025-01-15T19:16:00Z'),
      makeEntry('p04', 680, '2025-01-15T19:12:00Z'),
      makeEntry('p03', 650, '2025-01-15T19:08:00Z'),
      makeEntry('p02', 120, '2025-01-15T19:04:00Z'),
      makeEntry('p01', 100, '2025-01-15T19:00:00Z', 'baseline'),
    ],
  },
  {
    label: 'Single entry — just baseline',
    entries: [
      makeEntry('s01', 50, '2025-01-15T18:00:00Z', 'baseline'),
    ],
  },
  {
    label: 'Empty — no entries',
    entries: [],
  },
  {
    label: 'Dense — 80+ entries in one day',
    entries: Array.from({ length: 82 }, (_, i) => {
      const idx = 82 - i // newest first
      const mins = idx * 2
      const hour = Math.floor(mins / 60) + 15
      const min = mins % 60
      const time = `2025-01-15T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`
      const charCount = 50 + idx * 6 + (idx % 3 === 0 ? -10 : 0)
      return makeEntry(
        `d${String(idx).padStart(2, '0')}`,
        charCount,
        time,
        idx === 1 ? 'baseline' : 'autosave'
      )
    }),
  },
  {
    label: 'Multi-day — work across two days',
    entries: [
      makeEntry('md06', 400, '2025-01-16T19:08:00Z'),
      makeEntry('md05', 360, '2025-01-16T19:04:00Z'),
      makeEntry('md04', 300, '2025-01-16T19:00:00Z'),
      makeEntry('md03', 250, '2025-01-15T20:04:00Z'),
      makeEntry('md02', 180, '2025-01-15T20:00:00Z'),
      makeEntry('md01', 100, '2025-01-15T19:56:00Z', 'baseline'),
    ],
  },
]

function HistoryGraphGallery() {
  const [lastEvent, setLastEvent] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)

  return (
    <div className="bg-surface rounded-lg shadow-sm p-4">
      <h2 className="text-lg font-semibold text-text-default">History Graph</h2>
      <p className="text-text-muted text-sm mt-1">
        SVG timeline charts at sidebar widths. Hover to see tooltips, click stems to select.
      </p>

      {lastEvent && (
        <div className="mt-2 text-xs font-mono bg-surface-2 rounded px-2 py-1 text-text-muted">
          {lastEvent}
        </div>
      )}

      <div className="mt-4 space-y-6">
        {SCENARIOS.map((scenario) => (
          <div key={scenario.label}>
            <div className="text-sm font-medium text-text-default mb-2">
              {scenario.label}
            </div>
            <div className="flex gap-4 flex-wrap">
              {[256, 240].map((w) => (
                <div
                  key={w}
                  className="border border-border rounded"
                  style={{ width: w }}
                >
                  <div className="text-[10px] text-text-muted px-2 pt-1">
                    {w}px
                  </div>
                  <HistoryGraph
                    entries={scenario.entries}
                    activeEntryId={activeId}
                    onEntryClick={(entry) => {
                      setActiveId(entry.id)
                      setLastEvent(`click: ${entry.id} (${entry.char_count} chars)`)
                    }}
                    onEntryHover={(entry) => {
                      setLastEvent(`hover: ${entry.id} (${entry.char_count} chars)`)
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
