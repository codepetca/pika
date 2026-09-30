'use client'

import { useEffect, useMemo, useState } from 'react'
import { RichTextViewer } from '@/components/editor'
import { markdownToTiptapContent } from '@/lib/limited-markdown'
import { fetchCachedJSON } from '@/lib/request-cache'
import type { CourseBlueprintAuthoringGuidance } from '@/lib/course-blueprint-authoring-guidance'
import type { Classroom } from '@/types'
import { Button, PageContent, PageHeading, PageLayout, PageState, SegmentedControl } from '@/ui'

type BlueprintSection = 'overview' | 'content' | 'guidance'

type ClassroomBlueprintContext = {
  source_blueprint_version_id: string
  source_blueprint_version_number: number
  source_draft_revision: number
  guidance: CourseBlueprintAuthoringGuidance
  course: {
    title: string
    subject: string
    grade_level: string
    outline_markdown: string
    assignment_titles: string[]
    test_titles: string[]
  }
}

type BlueprintState =
  | { status: 'loading' }
  | { status: 'ready'; context: ClassroomBlueprintContext | null }
  | { status: 'error' }

const SECTIONS: Array<{ value: BlueprintSection; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'content', label: 'Content' },
  { value: 'guidance', label: 'Authoring Guidance' },
]

const BLUEPRINT_SECTIONS = new Set<BlueprintSection>(SECTIONS.map((section) => section.value))

function parseBlueprintSection(value: string | null | undefined): BlueprintSection {
  return value && BLUEPRINT_SECTIONS.has(value as BlueprintSection)
    ? value as BlueprintSection
    : 'overview'
}

function MarkdownSection({ title, markdown, emptyText }: {
  title: string
  markdown: string
  emptyText: string
}) {
  const content = useMemo(() => markdownToTiptapContent(markdown), [markdown])

  return (
    <section className="rounded-card border border-border bg-surface p-4 sm:p-5">
      <h2 className="text-base font-semibold text-text-default">{title}</h2>
      {markdown.trim() ? (
        <div className="mt-3 min-w-0">
          <RichTextViewer content={content} chrome="flush" />
        </div>
      ) : (
        <p className="mt-2 text-sm text-text-muted">{emptyText}</p>
      )}
    </section>
  )
}

function TitleList({ title, titles }: { title: string; titles: string[] }) {
  return (
    <section className="rounded-card border border-border bg-surface p-4 sm:p-5">
      <h2 className="text-base font-semibold text-text-default">{title}</h2>
      {titles.length ? (
        <ul className="mt-3 divide-y divide-border text-sm text-text-default">
          {titles.map((item, index) => (
            <li key={`${item}-${index}`} className="py-2 first:pt-0 last:pb-0">{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-text-muted">No {title.toLowerCase()} in this Version.</p>
      )}
    </section>
  )
}

export function TeacherBlueprintTab({ classroom, isActive, sectionParam, onSectionChange = () => {} }: {
  classroom: Classroom
  isActive: boolean
  sectionParam?: string | null
  onSectionChange?: (section: BlueprintSection) => void
}) {
  const [state, setState] = useState<BlueprintState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const section = parseBlueprintSection(sectionParam)

  useEffect(() => {
    if (!isActive) return
    let current = true
    setState({ status: 'loading' })

    void fetchCachedJSON<{ context: ClassroomBlueprintContext | null }>(
      `classroom-authoring-guidance:${classroom.id}`,
      `/api/teacher/classrooms/${encodeURIComponent(classroom.id)}/authoring-guidance`,
      { errorMessage: 'The classroom Blueprint could not be loaded.', ttlMs: 0 },
    ).then((response) => {
      if (current) setState({ status: 'ready', context: response.context })
    }).catch(() => {
      if (current) setState({ status: 'error' })
    })

    return () => { current = false }
  }, [attempt, classroom.id, isActive])

  const context = state.status === 'ready' ? state.context : null
  const course = context?.course
  const guidance = context?.guidance
  return (
    <PageLayout width="wide">
      <div className="mb-2 overflow-x-auto pb-1">
        <SegmentedControl
          ariaLabel="Blueprint section"
          value={section}
          options={SECTIONS}
          onChange={onSectionChange}
          className="[&_button]:min-h-11"
        />
      </div>
      <PageContent className="space-y-5 pt-0 pb-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageHeading
            title="Blueprint"
            description={course?.title || 'The saved Blueprint Version for this classroom.'}
          />
          {context ? (
            <span className="rounded-control border border-border bg-surface-2 px-3 py-2 text-sm text-text-muted">
              Version {context.source_blueprint_version_number}
            </span>
          ) : null}
        </div>

        {state.status === 'loading' ? (
          <PageState kind="loading" title="Loading Blueprint" />
        ) : state.status === 'error' ? (
          <PageState
            kind="error"
            title="Could not load Blueprint"
            description="The saved classroom Version is temporarily unavailable."
            action={<Button type="button" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Try again</Button>}
          />
        ) : !context || !course || !guidance ? (
          <PageState
            kind="empty"
            title="No Blueprint Version linked"
            description="This classroom was not created from a saved Blueprint Version."
          />
        ) : (
          <>
            <p className="rounded-card border border-border bg-surface-2 px-4 py-3 text-sm text-text-muted">
              This is the Version saved with this classroom. Later edits to the source Blueprint do not change it.
            </p>
            <div role="region" aria-label={`${SECTIONS.find((item) => item.value === section)?.label} Blueprint section`}>
              {section === 'overview' ? (
                <div className="space-y-4">
                  <section className="rounded-card border border-border bg-surface p-4 sm:p-5">
                    <h2 className="text-base font-semibold text-text-default">Course</h2>
                    <p className="mt-2 text-sm text-text-default">{course.title || classroom.title}</p>
                    {[course.subject, course.grade_level && `Grade ${course.grade_level}`]
                      .filter(Boolean).length ? (
                        <p className="mt-1 text-sm text-text-muted">
                          {[course.subject, course.grade_level && `Grade ${course.grade_level}`].filter(Boolean).join(' · ')}
                        </p>
                      ) : null}
                  </section>
                  <MarkdownSection title="Course outline" markdown={course.outline_markdown} emptyText="No outline saved in this Version." />
                </div>
              ) : section === 'content' ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <TitleList title="Assignments" titles={course.assignment_titles} />
                  <TitleList title="Tests" titles={course.test_titles} />
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-text-muted">Teacher only · Drafts use these saved course and unit rules.</p>
                  <MarkdownSection title="Course expectations" markdown={guidance.course_expectations_markdown} emptyText="No course expectations saved." />
                  <MarkdownSection title="Assignment rules" markdown={guidance.assignment_guidance_markdown} emptyText="No assignment rules saved." />
                  <MarkdownSection title="Test rules" markdown={guidance.test_guidance_markdown} emptyText="No test rules saved." />
                  {guidance.unit_exceptions.length ? (
                    <section className="space-y-4">
                      <h2 className="text-base font-semibold text-text-default">Unit rules</h2>
                      {guidance.unit_exceptions.map((unit) => (
                        <div key={unit.id} className="space-y-3 rounded-card border border-border bg-surface-2 p-4 sm:p-5">
                          <h3 className="font-semibold text-text-default">{unit.unit_label}</h3>
                          <MarkdownSection title="Assignment rules" markdown={unit.assignment_guidance_markdown} emptyText="No additional assignment rules." />
                          <MarkdownSection title="Test rules" markdown={unit.test_guidance_markdown} emptyText="No additional test rules." />
                        </div>
                      ))}
                    </section>
                  ) : null}
                </div>
              )}
            </div>
          </>
        )}
      </PageContent>
    </PageLayout>
  )
}
