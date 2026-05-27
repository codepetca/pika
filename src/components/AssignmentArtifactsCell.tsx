'use client'

import { useState } from 'react'
import { ExternalLink, FolderGit2, Image as ImageIcon, Link2 } from 'lucide-react'
import {
  summarizeArtifactUrl,
  type AssignmentArtifact,
} from '@/lib/assignment-artifacts'
import { ContentDialog, Tooltip } from '@/ui'

interface AssignmentArtifactsCellProps {
  artifacts: AssignmentArtifact[]
  isCompact: boolean
}

function getArtifactLabel(artifact: AssignmentArtifact): string {
  const prefix = artifact.title?.trim() || (artifact.type === 'image' ? 'Image' : artifact.type === 'repo' ? 'Repo' : 'Link')
  return `${prefix} . ${summarizeArtifactUrl(artifact.url)}`
}

function getArtifactSummary(artifact: AssignmentArtifact): string {
  return summarizeArtifactUrl(artifact.url)
}

function getArtifactTypeLabel(artifact: AssignmentArtifact): string {
  if (artifact.title?.trim()) return artifact.title.trim()
  if (artifact.type === 'image') return 'Image'
  if (artifact.type === 'repo') return 'Repo'
  return 'Link'
}

function getArtifactKindLabel(artifact: AssignmentArtifact): string {
  if (artifact.type === 'image') return 'Image'
  if (artifact.type === 'repo') return 'Repo'
  return 'Link'
}

function isRequiredSubmissionArtifact(artifact: AssignmentArtifact): boolean {
  return artifact.is_required_submission === true
}

function getSubmissionArtifactStatusLabel(artifact: AssignmentArtifact): string | null {
  if (isRequiredSubmissionArtifact(artifact)) return 'Required submission'
  if (artifact.requirement_id) return 'Optional submission'
  return null
}

function getArtifactIconClassName(artifact: AssignmentArtifact) {
  return [
    'h-3.5 w-3.5 shrink-0',
    isRequiredSubmissionArtifact(artifact) ? 'text-primary' : 'text-text-muted',
  ].join(' ')
}

function ArtifactTypeIcon({ artifact }: { artifact: AssignmentArtifact }) {
  const className = getArtifactIconClassName(artifact)

  if (artifact.type === 'image') {
    return <ImageIcon className={className} aria-hidden="true" />
  }
  if (artifact.type === 'repo') {
    return <FolderGit2 className={className} aria-hidden="true" />
  }
  return <Link2 className={className} aria-hidden="true" />
}

function ArtifactsTooltipList({
  artifacts,
  activeIndex,
}: {
  artifacts: AssignmentArtifact[]
  activeIndex: number
}) {
  const handleArtifactClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation()
  }

  return (
    <div className="w-72 max-w-[calc(100vw-2rem)]">
      <div className="mb-1 text-[11px] font-semibold text-text-muted">
        {artifacts.length} artifact{artifacts.length === 1 ? '' : 's'}
      </div>
      <div className="space-y-1">
        {artifacts.map((artifact, index) => {
          const statusLabel = getSubmissionArtifactStatusLabel(artifact)
          const isRequiredSubmission = isRequiredSubmissionArtifact(artifact)
          const borderClass = isRequiredSubmission
            ? 'border-primary/50'
            : index === activeIndex
              ? 'border-primary/40'
              : 'border-border'
          const surfaceClass = index === activeIndex ? 'bg-surface-selected' : 'bg-surface-2'

          return (
            <a
              key={`${artifact.url}:${index}`}
              href={artifact.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleArtifactClick}
              aria-label={`Open ${statusLabel ? `${statusLabel.toLowerCase()} ` : ''}artifact ${index + 1}: ${getArtifactTypeLabel(artifact)} . ${getArtifactSummary(artifact)}`}
              className={[
                'flex min-w-0 items-start gap-2 rounded-md border px-2 py-1.5',
                borderClass,
                surfaceClass,
                'hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface',
              ].join(' ')}
            >
              <span className="mt-0.5 inline-flex h-5 min-w-8 shrink-0 items-center justify-center gap-1 rounded-full border border-border bg-surface text-[11px] font-medium text-text-default">
                <ArtifactTypeIcon artifact={artifact} />
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium text-text-default">
                  {getArtifactTypeLabel(artifact)} . {getArtifactSummary(artifact)}
                </span>
                <span className="block truncate text-[11px] text-text-muted">
                  {statusLabel ?? getArtifactKindLabel(artifact)} . {artifact.url}
                </span>
              </span>
            </a>
          )
        })}
      </div>
    </div>
  )
}

export function AssignmentArtifactsCell({
  artifacts,
}: AssignmentArtifactsCellProps) {
  const [isChooserOpen, setIsChooserOpen] = useState(false)

  const hasMultipleArtifacts = artifacts.length > 1

  const handleOpenChooser = (event: React.MouseEvent) => {
    event.stopPropagation()
    setIsChooserOpen(true)
  }

  const handleOpenSingle = (event: React.MouseEvent) => {
    event.stopPropagation()
  }

  if (artifacts.length === 0) {
    return <span className="text-text-muted">-</span>
  }

  return (
    <>
      <div className="flex w-full max-w-full flex-wrap gap-1">
        {artifacts.map((artifact, index) => (
          <Tooltip
            key={`${artifact.url}:${index}`}
            content={<ArtifactsTooltipList artifacts={artifacts} activeIndex={index} />}
            interactive
            side="bottom"
            align="start"
          >
            {(() => {
              const isRequiredSubmission = isRequiredSubmissionArtifact(artifact)
              const requiredLabel = isRequiredSubmission ? 'required submission ' : ''
              const pillClassName = [
                'inline-flex h-6 min-w-9 items-center justify-center gap-1 rounded-full border px-1.5 text-xs font-medium',
                isRequiredSubmission
                  ? 'border-transparent bg-info-bg-hover text-primary hover:bg-info-bg-hover'
                  : 'border-border bg-surface-2 text-text-default hover:bg-surface-hover',
              ].join(' ')

              return hasMultipleArtifacts ? (
                <button
                  type="button"
                  onClick={handleOpenChooser}
                  className={pillClassName}
                  aria-label={`View work items; ${requiredLabel}artifact ${index + 1} is ${getArtifactLabel(artifact)}`}
                >
                  <ArtifactTypeIcon artifact={artifact} />
                  <span>{index + 1}</span>
                </button>
              ) : (
                <a
                  href={artifact.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleOpenSingle}
                  className={pillClassName}
                  aria-label={`Open ${requiredLabel}artifact ${index + 1}: ${getArtifactLabel(artifact)}`}
                >
                  <ArtifactTypeIcon artifact={artifact} />
                  <span>{index + 1}</span>
                </a>
              )
            })()}
          </Tooltip>
        ))}
      </div>

      <ContentDialog
        isOpen={isChooserOpen}
        onClose={() => setIsChooserOpen(false)}
        title="Open artifact"
        subtitle={`${artifacts.length} work items`}
        maxWidth="max-w-md"
        showFooterClose={false}
      >
        <div className="space-y-2">
          {artifacts.map((artifact, index) => {
            const statusLabel = getSubmissionArtifactStatusLabel(artifact)
            const isRequiredSubmission = isRequiredSubmissionArtifact(artifact)

            return (
              <a
                key={`${artifact.url}:${index}`}
                href={artifact.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsChooserOpen(false)}
                className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-surface p-2.5 text-left hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface"
              >
                <span className={[
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border',
                  isRequiredSubmission
                    ? 'border-primary/50 bg-info-bg'
                    : 'border-border bg-surface-2',
                ].join(' ')}>
                  <ArtifactTypeIcon artifact={artifact} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text-default">
                    {getArtifactTypeLabel(artifact)} . {getArtifactSummary(artifact)}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-text-muted">
                    {statusLabel ?? getArtifactKindLabel(artifact)} . {artifact.url}
                  </span>
                </span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
              </a>
            )
          })}
        </div>
      </ContentDialog>
    </>
  )
}
