'use client'

import { useCallback, type HTMLAttributes, type KeyboardEvent, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

export type DataTableDensity = 'tight' | 'compact' | 'normal'
export type SortDirection = 'asc' | 'desc'

function densityPadding(density: DataTableDensity) {
  if (density === 'tight') return 'px-3 py-1'
  if (density === 'compact') return 'px-4 py-2'
  return 'px-4 py-3'
}

export function TableCard({
  children,
  overflowX = false,
}: {
  children: ReactNode
  overflowX?: boolean
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className={overflowX ? 'overflow-x-auto' : undefined}>{children}</div>
    </div>
  )
}

export function DataTable({ children }: { children: ReactNode }) {
  return <table className="w-full">{children}</table>
}

export function DataTableHead({ children }: { children: ReactNode }) {
  return (
    <thead
      className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
    >
      {children}
    </thead>
  )
}

export function DataTableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-gray-200 dark:divide-gray-700">{children}</tbody>
}

export function DataTableRow({
  children,
  className = '',
  ...props
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={className} {...props}>
      {children}
    </tr>
  )
}

export function DataTableHeaderCell({
  children,
  density = 'compact',
  align = 'left',
  className = '',
  ...props
}: {
  children: ReactNode
  density?: DataTableDensity
  align?: 'left' | 'center' | 'right'
  className?: string
} & ThHTMLAttributes<HTMLTableCellElement>) {
  const alignClass =
    align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'
  return (
    <th
      className={[
        densityPadding(density),
        alignClass,
        'text-sm font-medium text-gray-700 dark:text-gray-300',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </th>
  )
}

export function SortableHeaderCell({
  label,
  isActive,
  direction,
  onClick,
  density = 'compact',
  align = 'left',
}: {
  label: string
  isActive: boolean
  direction: SortDirection
  onClick: () => void
  density?: DataTableDensity
  align?: 'left' | 'center' | 'right'
}) {
  const alignClass =
    align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-start'
  const ariaSort = isActive ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
  const Icon = direction === 'asc' ? ChevronUp : ChevronDown

  return (
    <DataTableHeaderCell density={density} align={align} className="!p-0" aria-sort={ariaSort}>
      <button
        type="button"
        onClick={onClick}
        className={[
          densityPadding(density),
          'w-full flex items-center gap-1',
          alignClass,
          'hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors',
        ].join(' ')}
      >
        <span className="truncate">{label}</span>
        <Icon
          className={[
            'h-4 w-4 flex-shrink-0',
            isActive ? 'text-gray-500 dark:text-gray-400' : 'opacity-0',
          ].join(' ')}
          aria-hidden="true"
        />
      </button>
    </DataTableHeaderCell>
  )
}

export function DataTableCell({
  children,
  density = 'compact',
  align = 'left',
  className = '',
  ...props
}: {
  children: ReactNode
  density?: DataTableDensity
  align?: 'left' | 'center' | 'right'
  className?: string
} & TdHTMLAttributes<HTMLTableCellElement>) {
  const alignClass =
    align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'
  return (
    <td
      className={[
        densityPadding(density),
        alignClass,
        'text-sm text-gray-900 dark:text-gray-100',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </td>
  )
}

export function EmptyStateRow({
  colSpan,
  message,
  density = 'compact',
}: {
  colSpan: number
  message: string
  density?: DataTableDensity
}) {
  return (
    <DataTableRow>
      <td colSpan={colSpan} className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
        {message}
      </td>
    </DataTableRow>
  )
}

/**
 * Wrapper component that adds keyboard navigation (↑/↓ arrows) to a table.
 * Use this to wrap TableCard when you need row selection with keyboard support.
 */
export function KeyboardNavigableTable<K extends string>({
  children,
  rowKeys,
  selectedKey,
  onSelectKey,
  wrap = true,
}: {
  children: ReactNode
  /** Array of row keys in display order */
  rowKeys: K[]
  /** Currently selected row key */
  selectedKey: K | null
  /** Callback when selection changes */
  onSelectKey: (key: K) => void
  /** Whether to wrap around at the ends (default: true) */
  wrap?: boolean
}) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (rowKeys.length === 0) return
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return

      e.preventDefault()

      const currentIndex = selectedKey ? rowKeys.indexOf(selectedKey) : -1
      let nextIndex: number

      if (e.key === 'ArrowDown') {
        if (currentIndex === -1) {
          nextIndex = 0
        } else if (currentIndex === rowKeys.length - 1) {
          nextIndex = wrap ? 0 : currentIndex
        } else {
          nextIndex = currentIndex + 1
        }
      } else {
        // ArrowUp
        if (currentIndex === -1) {
          nextIndex = rowKeys.length - 1
        } else if (currentIndex === 0) {
          nextIndex = wrap ? rowKeys.length - 1 : currentIndex
        } else {
          nextIndex = currentIndex - 1
        }
      }

      if (nextIndex !== currentIndex) {
        onSelectKey(rowKeys[nextIndex])
      }
    },
    [rowKeys, selectedKey, onSelectKey, wrap]
  )

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg"
    >
      {children}
    </div>
  )
}
