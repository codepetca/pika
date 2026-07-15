import { ArchiveRestore } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { Button } from '@/ui'
import type { ClassroomColdArchiveSummary } from '@/lib/contracts/classroom-lifecycle'

interface Props {
  archive: ClassroomColdArchiveSummary
  restoreEnabled: boolean
  disabled?: boolean
  onRestore: () => void
}

export function ColdClassroomArchiveRow({
  archive,
  restoreEnabled,
  disabled = false,
  onRestore,
}: Props) {
  const archivedDate = formatInTimeZone(
    new Date(archive.archived_at),
    'America/Toronto',
    'MMM d, yyyy',
  )

  return (
    <div
      data-testid="cold-classroom-archive"
      className="flex flex-col gap-3 rounded-card border border-border bg-surface px-5 py-4 shadow-elevated lg:grid lg:grid-cols-[minmax(0,1fr),auto] lg:items-center lg:gap-5"
    >
      <div className="min-w-0">
        <div className="truncate text-base font-semibold text-text-default">{archive.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
          <span className="inline-flex items-center gap-1.5 font-medium text-text-default">
            <ArchiveRestore className="h-4 w-4 text-primary" aria-hidden="true" />
            Stored archive
          </span>
          <span aria-hidden="true">&middot;</span>
          <span>Archived {archivedDate}</span>
        </div>
      </div>
      <div className="flex items-center lg:justify-end">
        <Button
          type="button"
          variant="surface"
          size="xs"
          onClick={onRestore}
          disabled={disabled || !restoreEnabled}
          title={restoreEnabled ? undefined : 'Restore is not enabled for this classroom'}
        >
          <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Restore</span>
        </Button>
      </div>
    </div>
  )
}
