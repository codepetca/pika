import { User, Users } from 'lucide-react'
import { Button, Tooltip } from '@/ui'
import { getNextAssignmentSplitPaneView, type AssignmentSplitPaneView } from '@/lib/assignment-grading-layout'

/** Classwork's left pane switches while the marking pane remains visible. */
export function AssignmentWorkspaceViewToggle({
  view,
  onChange,
  disabled = false,
}: {
  view: AssignmentSplitPaneView
  onChange: (view: AssignmentSplitPaneView) => void
  disabled?: boolean
}) {
  const individual = view === 'content-grading'
  return (
    <Tooltip content={individual ? 'Show student table' : 'Show individual student'}>
      <span className="inline-flex">
        <Button
          type="button"
          variant="surface"
          size="sm"
          aria-label={`Change assignment layout: ${individual ? 'Individual student' : 'Student table'}`}
          onClick={() => onChange(getNextAssignmentSplitPaneView(view))}
          disabled={disabled}
          className="px-2.5"
        >
          <span data-testid="assignment-split-pane-indicator" data-view-panes={view} aria-hidden="true">
            <span className="inline-flex" data-testid="assignment-split-pane-icons">
              {individual
                ? <User className="h-4 w-4" aria-hidden="true" />
                : <Users className="h-4 w-4" aria-hidden="true" />}
            </span>
          </span>
        </Button>
      </span>
    </Tooltip>
  )
}
