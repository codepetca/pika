'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'

interface Snapshot {
  filename: string
  name: string
}

export function SnapshotGallery() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'auth' | 'teacher' | 'student'>('all')

  useEffect(() => {
    fetch('/api/snapshots/list')
      .then((res) => res.json())
      .then((data) => {
        setSnapshots(data.snapshots)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load snapshots:', err)
        setLoading(false)
      })
  }, [])

  const filteredSnapshots = snapshots.filter((snapshot) => {
    if (filter === 'all') return true
    return snapshot.filename.startsWith(filter)
  })

  const groupedSnapshots = {
    auth: filteredSnapshots.filter((s) => s.filename.startsWith('auth')),
    teacher: filteredSnapshots.filter((s) => s.filename.startsWith('teacher')),
    student: filteredSnapshots.filter((s) => s.filename.startsWith('student')),
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="text-text-muted">Loading snapshots...</div>
      </div>
    )
  }

  if (snapshots.length === 0) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-text-default mb-2">No snapshots found</h1>
          <p className="text-text-muted mb-4">
            Run <code className="bg-surface-2 px-2 py-1 rounded">pnpm run e2e:snapshots:update</code> to
            generate snapshots
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-page">
      {/* Header */}
      <div className="bg-surface border-b border-border sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-text-default">UI Snapshot Gallery</h1>
              <p className="text-sm text-text-muted mt-1">
                {snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''} captured
              </p>
            </div>

            {/* Filter buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => setFilter('all')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-surface text-text-default border border-border hover:bg-page'
                }`}
              >
                All ({snapshots.length})
              </button>
              <button
                onClick={() => setFilter('auth')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filter === 'auth'
                    ? 'bg-blue-600 text-white'
                    : 'bg-surface text-text-default border border-border hover:bg-page'
                }`}
              >
                Auth ({groupedSnapshots.auth.length})
              </button>
              <button
                onClick={() => setFilter('teacher')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filter === 'teacher'
                    ? 'bg-blue-600 text-white'
                    : 'bg-surface text-text-default border border-border hover:bg-page'
                }`}
              >
                Teacher ({groupedSnapshots.teacher.length})
              </button>
              <button
                onClick={() => setFilter('student')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filter === 'student'
                    ? 'bg-blue-600 text-white'
                    : 'bg-surface text-text-default border border-border hover:bg-page'
                }`}
              >
                Student ({groupedSnapshots.student.length})
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Gallery Grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSnapshots.map((snapshot) => (
            <div key={snapshot.filename} className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden hover:shadow-md transition-shadow">
              {/* Snapshot name */}
              <div className="px-4 py-3 border-b border-border bg-page">
                <h3 className="text-sm font-medium text-text-default truncate" title={snapshot.name}>
                  {snapshot.name}
                </h3>
              </div>

              {/* Snapshot image */}
              <a
                href={`/api/snapshots/${snapshot.filename}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block relative aspect-[4/3] bg-surface-2 overflow-hidden group"
              >
                <Image
                  src={`/api/snapshots/${snapshot.filename}`}
                  alt={snapshot.name}
                  fill
                  sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  className="object-contain object-top group-hover:scale-105 transition-transform duration-200"
                  unoptimized
                />
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 transition-opacity flex items-center justify-center">
                  <div className="opacity-0 group-hover:opacity-100 bg-surface px-4 py-2 rounded-md text-sm font-medium text-text-default shadow-lg transition-opacity">
                    View Full Size
                  </div>
                </div>
              </a>

              {/* Filename */}
              <div className="px-4 py-2 bg-page border-t border-border">
                <code className="text-xs text-text-muted break-all">{snapshot.filename}</code>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
