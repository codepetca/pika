'use client'

import { useEffect, useState } from 'react'
import { RichTextViewer } from '@/components/editor'
import { markdownToTiptapContent } from '@/lib/limited-markdown'
import { fetchCachedJSON } from '@/lib/request-cache'
import { classroomBlueprintMaterialsResponseSchema, type ClassroomBlueprintMaterials as Materials } from '@/lib/validations/classroom-blueprint-materials'
import { Button, PageState } from '@/ui'

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; materials: Materials | null }

export function ClassroomBlueprintMaterials({ classroomId }: { classroomId: string }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void fetchCachedJSON<{ materials: Materials | null }>(
      `classroom-blueprint-materials:${classroomId}`,
      `/api/teacher/classrooms/${encodeURIComponent(classroomId)}/blueprint-materials`,
      { errorMessage: 'Could not load Blueprint materials.', ttlMs: 0 },
    ).then((result) => {
      const parsed = classroomBlueprintMaterialsResponseSchema.parse(result)
      if (current) setState({ status: 'ready', materials: parsed.materials })
    }).catch(() => {
      if (current) setState({ status: 'error' })
    })
    return () => { current = false }
  }, [attempt, classroomId])

  return <section aria-label="Blueprint materials" className="rounded-card bg-surface p-4 sm:p-5">
    <h2 className="text-base font-semibold text-text-default">Materials</h2>
    {state.status === 'loading' ? <PageState kind="loading" title="Loading materials" />
      : state.status === 'error' ? <PageState kind="error" title="Could not load materials"
        action={<Button type="button" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Try again</Button>} />
      : !state.materials ? <p className="mt-2 text-sm text-text-muted">No linked Blueprint materials.</p>
      : <>
        <p className="mt-2 text-sm text-text-muted">Latest saved Blueprint · Version {state.materials.version_number}</p>
        <p className="mt-1 text-sm text-text-muted">These reusable materials may be newer than this classroom’s Content Version.</p>
        {state.materials.materials.length ? <div className="mt-4 space-y-5">
          {state.materials.materials.map((material) => <div key={material.artifact_id} className="min-w-0">
            <h3 className="text-sm font-semibold text-text-default">{material.title}</h3>
            {material.content_markdown.trim() && <div className="mt-2">
              <RichTextViewer content={markdownToTiptapContent(material.content_markdown)} chrome="flush" />
            </div>}
          </div>)}
        </div> : <p className="mt-3 text-sm text-text-muted">No materials in the latest saved Blueprint.</p>}
      </>}
  </section>
}
