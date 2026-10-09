'use client'

import { useEffect, useInsertionEffect, useRef, useState } from 'react'
import { fetchCachedJSON } from '@/lib/request-cache'

type Props = {
  classroomId: string
  target: 'assignments' | 'tests'
  artifactId: string | null | undefined
  isOpen: boolean
  /** Keep only already displayed metadata during an outgoing visual lifetime. */
  retainOnClose?: boolean
}

type Source = {
  source_blueprint_version_number: number
  unit_label: string | null
}

/** A teacher-only source note. Guidance itself never enters artifact content. */
export function ClassroomBlueprintDraftSource({ classroomId, target, artifactId, isOpen, retainOnClose = false }: Props) {
  const [source, setSource] = useState<Source | null>(null)

  const ownerRef = useRef({ classroomId, target, artifactId, isOpen })
  useInsertionEffect(() => {
    // Retire publication at commit, before layout callbacks or passive cleanup.
    // A suspended render must leave the committed open request eligible.
    const owner = { classroomId, target, artifactId, isOpen }
    ownerRef.current = owner
    return () => {
      if (ownerRef.current === owner) ownerRef.current = { ...owner, isOpen: false }
    }
  }, [classroomId, target, artifactId, isOpen])

  useEffect(() => {
    if (!isOpen || !artifactId) {
      if (!retainOnClose) setSource(null)
      return
    }
    const requestOwner = ownerRef.current
    let active = true
    setSource(null)
    const params = new URLSearchParams({ target, artifact_id: artifactId })
    void (async () => {
      try {
        const body = await fetchCachedJSON<{ provenance?: Source | null }>(
          `classroom-draft-source:${classroomId}:${target}:${artifactId}`,
          `/api/teacher/classrooms/${classroomId}/authoring-drafts/provenance?${params}`,
        )
        if (active && ownerRef.current === requestOwner && ownerRef.current.isOpen) {
          setSource(body.provenance ?? null)
        }
      } catch {
        // Source metadata is optional; the editor remains usable if it cannot load.
      }
    })()
    return () => { active = false }
  }, [artifactId, classroomId, isOpen, retainOnClose, target])

  if (!source || (!isOpen && !retainOnClose)) return null
  return (
    <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted">
      Drafted with Blueprint Version {source.source_blueprint_version_number}
      {source.unit_label ? ` · ${source.unit_label}` : ' · whole course'}
    </p>
  )
}
