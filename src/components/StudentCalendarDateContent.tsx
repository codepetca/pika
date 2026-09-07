'use client'

import { AnnouncementContent } from '@/components/AnnouncementContent'
import { RichTextViewer } from '@/components/editor'
import { getAnnouncementCalendarLabel, normalizeAnnouncementTitle } from '@/lib/announcements'
import { isCalendarAnnouncementScheduled } from '@/lib/calendar-items'
import { Button } from '@/ui'
import type { Announcement, Assignment, LessonPlan } from '@/types'

interface StudentCalendarDateContentProps {
  lessonPlan: LessonPlan | null
  assignments: Assignment[]
  announcements: Announcement[]
  onAssignmentClick?: (assignment: Assignment) => void
  onAnnouncementClick?: () => void
}

function hasLessonPlanContent(plan: LessonPlan | null) {
  return Boolean(
    plan?.content &&
    plan.content.content &&
    plan.content.content.length > 0,
  )
}

export function StudentCalendarDateContent({
  lessonPlan,
  assignments,
  announcements,
  onAssignmentClick,
  onAnnouncementClick,
}: StudentCalendarDateContentProps) {
  const hasCalendarItems = hasLessonPlanContent(lessonPlan) || assignments.length > 0 || announcements.length > 0

  if (!hasCalendarItems) return null

  return (
    <div className="min-h-0 flex-1 overflow-y-auto [&_.simple-viewer-content_.tiptap.ProseMirror.simple-editor]:!p-0">
      {hasLessonPlanContent(lessonPlan) ? (
        <RichTextViewer content={lessonPlan!.content} chrome="flush" />
      ) : null}

      {assignments.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <h4 className="text-xs font-semibold text-text-muted">Assignments</h4>
          <div className="mt-2 space-y-2">
            {assignments.map((assignment) => (
              <Button
                key={assignment.id}
                type="button"
                variant="secondary"
                size="sm"
                fullWidth
                onClick={() => onAssignmentClick?.(assignment)}
                className="justify-start text-left text-sm font-medium text-text-default"
                aria-label={`Open assignment ${assignment.title}`}
              >
                <span className="truncate">Due: {assignment.title}</span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {announcements.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <h4 className="text-xs font-semibold text-text-muted">Announcements</h4>
          <div className="mt-2 space-y-3">
            {announcements.map((announcement) => {
              const scheduled = isCalendarAnnouncementScheduled(announcement)
              const label = getAnnouncementCalendarLabel(announcement, scheduled)
              const title = normalizeAnnouncementTitle(announcement.title)

              return (
                <div key={announcement.id}>
                  {title ? (
                    <h5 className="text-sm font-semibold text-text-default">{title}</h5>
                  ) : (
                    <p className="text-xs font-semibold text-text-muted">{label}</p>
                  )}
                  <AnnouncementContent content={announcement.content} className="mt-1" />
                </div>
              )
            })}
          </div>
          {onAnnouncementClick ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={onAnnouncementClick}
              className="mt-2 px-2 text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              View all announcements
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}
