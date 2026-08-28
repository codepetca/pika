'use client'

import { useId } from 'react'
import { Check, ExternalLink, FileInput, Minus } from 'lucide-react'
import { getCourseGuidePublicSharingReadiness } from '@/lib/course-guide'
import type { ActualCourseSiteConfig } from '@/types'
import { Button, ContentDialog, FormField, Input, cn } from '@/ui'

const VISIBILITY_OPTIONS: Array<[keyof ActualCourseSiteConfig, string]> = [
  ['overview', 'Curriculum overview'],
  ['resources', 'Resources'],
  ['assignments', 'Assignments'],
  ['tests', 'Tests'],
]

type CourseGuideOptionsDialogProps = {
  isOpen: boolean
  saving: boolean
  error: string
  published: boolean
  slug: string
  config: ActualCourseSiteConfig
  onPublishedChange: (published: boolean) => void
  onSlugChange: (slug: string) => void
  onConfigChange: (config: ActualCourseSiteConfig) => void
  onGenerateSlug: () => void
  onOpenPublicGuide: () => void
  onImportCurriculum: () => void
  onSave: () => void
  onClose: () => void
}

export function CourseGuideOptionsDialog({
  isOpen,
  saving,
  error,
  published,
  slug,
  config,
  onPublishedChange,
  onSlugChange,
  onConfigChange,
  onGenerateSlug,
  onOpenPublicGuide,
  onImportCurriculum,
  onSave,
  onClose,
}: CourseGuideOptionsDialogProps) {
  const slugId = useId()
  const readiness = getCourseGuidePublicSharingReadiness({ enabled: published, slug })

  return (
    <ContentDialog
      isOpen={isOpen}
      onClose={saving ? () => {} : onClose}
      title="Guide options"
      subtitle="Choose the high-level course orientation students see and whether it is public."
      maxWidth="max-w-xl"
      showFooterClose={false}
    >
      <div className="space-y-4">
        <section aria-labelledby="guide-import-heading" className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 id="guide-import-heading" className="text-sm font-semibold text-text-default">
                Curriculum import
              </h4>
              <p className="mt-1 text-sm text-text-muted">
                Create a reviewable draft from one PDF or public document link.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={onImportCurriculum}
              className="shrink-0"
            >
              <FileInput className="h-4 w-4" aria-hidden="true" />
              Import curriculum
            </Button>
          </div>
        </section>

        <section aria-labelledby="guide-sharing-heading" className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 id="guide-sharing-heading" className="text-sm font-semibold text-text-default">
                Public sharing
              </h4>
              <p className="mt-1 text-sm text-text-muted">
                Enrolled students can always view the guide in Pika.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant={published ? 'primary' : 'secondary'}
              aria-pressed={published}
              aria-label="Share guide publicly"
              disabled={saving}
              onClick={() => onPublishedChange(!published)}
            >
              {published ? 'Public' : 'Private'}
            </Button>
          </div>

          <div
            role="status"
            className={cn(
              'rounded-control border px-3 py-2 text-sm',
              !published
                ? 'border-border bg-surface-2 text-text-muted'
                : readiness.ready
                  ? 'border-success bg-success-bg text-success'
                  : 'border-warning bg-warning-bg text-warning',
            )}
          >
            {!published
              ? 'Private to this classroom.'
              : readiness.ready
                ? 'Anyone with the link can view this guide.'
                : 'Add a public page address before saving.'}
          </div>

          {published ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <FormField label="Public page address" htmlFor={slugId}>
                  <Input
                    id={slugId}
                    value={slug}
                    onChange={(event) => onSlugChange(event.target.value)}
                    disabled={saving}
                    placeholder="course-name"
                  />
                </FormField>
              </div>
              <div className="flex items-end gap-2">
                <Button type="button" variant="secondary" onClick={onGenerateSlug} disabled={saving}>
                  Generate
                </Button>
                {readiness.ready ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={onOpenPublicGuide}
                    disabled={saving}
                    aria-label="Open public guide"
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="guide-sections-heading" className="border-t border-border pt-4">
          <h4 id="guide-sections-heading" className="text-sm font-semibold text-text-default">
            Guide sections
          </h4>
          <p className="mt-1 text-sm text-text-muted">
            Assignments and Tests appear as compact title lists. Daily course activity stays in its classroom tabs.
          </p>
          <div className="mt-3 divide-y divide-border">
            {VISIBILITY_OPTIONS.map(([key, label]) => {
              const shown = config[key] === true
              return (
                <div key={key} className="flex min-h-control items-center justify-between gap-3 py-1.5">
                  <span className="text-sm text-text-default">{label}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    aria-pressed={shown}
                    aria-label={`${shown ? 'Hide' : 'Show'} ${label}`}
                    disabled={saving}
                    onClick={() => onConfigChange({ ...config, [key]: !shown })}
                    className="min-w-20"
                  >
                    {shown ? (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Minus className="h-4 w-4" aria-hidden="true" />
                    )}
                    {shown ? 'Shown' : 'Hidden'}
                  </Button>
                </div>
              )
            })}
          </div>
        </section>

        {error ? (
          <div role="alert" className="rounded-control border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={onSave} disabled={saving || !readiness.ready}>
            {saving ? 'Saving...' : 'Save options'}
          </Button>
        </div>
      </div>
    </ContentDialog>
  )
}
