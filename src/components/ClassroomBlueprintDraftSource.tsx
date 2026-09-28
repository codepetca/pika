'use client'

import { useEffect, useState } from 'react'
import { fetchCachedJSON } from '@/lib/request-cache'

type Props = {
  classroomId: string
  target: 'assignments' | 'tests'
  artifactId: string | null | undefined
  isOpen: boolean
}

type Source = {
  source_blueprint_version_number: number
  unit_label: string | null
}

/** A teacher-only source note. Guidance itself never enters artifact content. */
export function ClassroomBlueprintDraftSource({ classroomId, target, artifactId, isOpen }: Props) {
  const [source, setSource] = useState<Source | null>(null)

  useEffect(() => {
    if (!isOpen || !artifactId) {
      setSource(null)
      return
    }
    let active = true
    setSource(null)
    const params = new URLSearchParams({ target, artifact_id: artifactId })
    void (async () => {
      try {
        const body = await fetchCachedJSON<{ provenance?: Source | null }>(
          `classroom-draft-source:${classroomId}:${target}:${artifactId}`,
          `/api/teacher/classrooms/${classroomId}/authoring-drafts/provenance?${params}`,
        )
        if (active) setSource(body.provenance ?? null)
      } catch {
        // Source metadata is optional; the editor remains usable if it cannot load.
      }
    })()
    return () => { active = false }
  }, [artifactId, classroomId, isOpen, target])

  if (!source) return null
  return (
    <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted">
      Drafted with Blueprint Version {source.source_blueprint_version_number}
      {source.unit_label ? ` · ${source.unit_label}` : ' · whole course'}
    </p>
  )
}
