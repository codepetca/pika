import { ReactNode } from 'react'

/**
 * Base compact student row component (36px height).
 * Provides consistent styling across all student lists.
 */
interface StudentRowBaseProps {
  email: string
  className?: string
  children?: ReactNode
}

function StudentRowBase({ email, className = '', children }: StudentRowBaseProps) {
  return (
    <div
      className={`flex items-center justify-between py-2 px-3 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${className}`}
    >
      <span className="text-sm text-gray-900 dark:text-gray-100 truncate flex-1">{email}</span>
      {children}
    </div>
  )
}

/**
 * Minimal variant for attendance view.
 * Shows only email + status indicator.
 */
interface StudentRowMinimalProps {
  email: string
  indicator: ReactNode
}

export function StudentRowMinimal({ email, indicator }: StudentRowMinimalProps) {
  return (
    <StudentRowBase email={email}>
      <div className="flex-shrink-0">{indicator}</div>
    </StudentRowBase>
  )
}

/**
 * Medium variant for roster view.
 * Shows email, name, student number, badge, and optional action.
 */
interface StudentRowMediumProps {
  email: string
  name?: string
  studentNumber?: string
  badge?: ReactNode
  action?: ReactNode
}

export function StudentRowMedium({
  email,
  name,
  studentNumber,
  badge,
  action,
}: StudentRowMediumProps) {
  return (
    <div className="flex items-center justify-between py-2 px-3 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{email}</div>
        {(name || studentNumber) && (
          <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            {name && <span className="font-medium truncate">{name}</span>}
            {studentNumber && <span className="text-gray-500 dark:text-gray-500">#{studentNumber}</span>}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
        {badge}
        {action}
      </div>
    </div>
  )
}

/**
 * Expandable variant for logs view.
 * Shows email, preview text, and expand/collapse toggle.
 */
interface StudentRowExpandableProps {
  label: string
  preview?: string | ReactNode
  expanded?: boolean
  expandedContent?: ReactNode
  onToggle?: () => void
}

export function StudentRowExpandable({
  label,
  preview,
  expanded = false,
  expandedContent,
  onToggle,
}: StudentRowExpandableProps) {
  return (
    <div className="border-b border-gray-200 dark:border-gray-700">
      <div
        className="flex items-center justify-between py-2 px-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{label}</div>
          {!expanded && preview && (
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 truncate">
              {preview}
            </div>
          )}
        </div>
        <span className="flex-shrink-0 ml-3 text-xs text-gray-500 dark:text-gray-400">
          {expanded ? '▴' : '▾'}
        </span>
      </div>
      {expanded && expandedContent && (
        <div className="px-3 pb-3 pt-1 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
          {expandedContent}
        </div>
      )}
    </div>
  )
}

/**
 * Compact namespace export for cleaner imports
 */
export const StudentRow = {
  Minimal: StudentRowMinimal,
  Medium: StudentRowMedium,
  Expandable: StudentRowExpandable,
}
