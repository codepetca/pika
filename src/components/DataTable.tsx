'use client'

import { createContext, forwardRef, useCallback, useContext, type HTMLAttributes, type KeyboardEvent, type ReactNode, type Ref, type TdHTMLAttributes, type ThHTMLAttributes } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

export type DataTableDensity = 'tight' | 'compact' | 'normal'
export type SortDirection = 'asc' | 'desc'

const DensityContext = createContext<DataTableDensity>('compact')

function useDensity(override?: DataTableDensity): DataTableDensity {
  const ctx = useContext(DensityContext)
  return override ?? ctx
}

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
    <div className="bg-surface rounded-lg border border-border overflow-hidden">
      <div className={overflowX ? 'overflow-x-auto' : undefined}>{children}</div>
    </div>
  )
}

export function DataTable({ children, density }: { children: ReactNode; density?: DataTableDensity }) {
  const table = <table className="w-full">{children}</table>
  return density ? <DensityContext.Provider value={density}>{table}</DensityContext.Provider> : table
}

export function DataTableHead({ children }: { children: ReactNode }) {
  return (
    <thead
      className="bg-surface-2 border-b border-border"
    >
      {children}
    </thead>
  )
}

export function DataTableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>
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
  density: densityProp,
  align = 'left',
  className = '',
  ...props
}: {
  children: ReactNode
  density?: DataTableDensity
  align?: 'left' | 'center' | 'right'
  className?: string
} & ThHTMLAttributes<HTMLTableCellElement>) {
  const density = useDensity(densityProp)
  const alignClass =
    align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'
  return (
    <th
      className={[
        densityPadding(density),
        alignClass,
        'text-sm font-medium text-text-muted',
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
  density: densityProp,
  align = 'left',
  className = '',
  trailing,
}: {
  label: string
  isActive: boolean
  direction: SortDirection
  onClick: () => void
  density?: DataTableDensity
  align?: 'left' | 'center' | 'right'
  className?: string
  trailing?: React.ReactNode
}) {
  const density = useDensity(densityProp)
  const alignClass =
    align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-start'
  const ariaSort = isActive ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
  const Icon = direction === 'asc' ? ChevronUp : ChevronDown

  return (
    <DataTableHeaderCell density={density} align={align} className={['!p-0', className].join(' ')} aria-sort={ariaSort}>
      <button
        type="button"
        onClick={onClick}
        className={[
          densityPadding(density),
          'w-full flex items-center gap-1',
          alignClass,
          'hover:bg-surface-hover transition-colors',
        ].join(' ')}
      >
        <span className="truncate">{label}</span>
        <Icon
          className={[
            'h-4 w-4 flex-shrink-0',
            isActive ? 'text-text-muted' : 'opacity-0',
          ].join(' ')}
          aria-hidden="true"
        />
        {trailing}
      </button>
    </DataTableHeaderCell>
  )
}

export function DataTableCell({
  children,
  density: densityProp,
  align = 'left',
  className = '',
  ...props
}: {
  children: ReactNode
  density?: DataTableDensity
  align?: 'left' | 'center' | 'right'
  className?: string
} & TdHTMLAttributes<HTMLTableCellElement>) {
  const density = useDensity(densityProp)
  const alignClass =
    align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'
  return (
    <td
      className={[
        densityPadding(density),
        alignClass,
        'text-sm text-text-default',
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
}: {
  colSpan: number
  message: string
}) {
  return (
    <DataTableRow>
      <td colSpan={colSpan} className="py-12 text-center text-sm text-text-muted">
        {message}
      </td>
    </DataTableRow>
  )
}

/**
 * Wrapper component that adds keyboard navigation (↑/↓ arrows) to a table.
 * Use this to wrap TableCard when you need row selection with keyboard support.
 */
export const KeyboardNavigableTable = forwardRef(function KeyboardNavigableTable<K extends string>({
  children,
  rowKeys,
  selectedKey,
  onSelectKey,
  onDeselect,
  wrap = true,
}: {
  children: ReactNode
  /** Array of row keys in display order */
  rowKeys: K[]
  /** Currently selected row key */
  selectedKey: K | null
  /** Callback when selection changes */
  onSelectKey: (key: K) => void
  /** Callback when selection is cleared (Escape key) */
  onDeselect?: () => void
  /** Whether to wrap around at the ends (default: true) */
  wrap?: boolean
}, ref: Ref<HTMLDivElement>) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape' && selectedKey && onDeselect) {
        e.preventDefault()
        onDeselect()
        return
      }

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
    [rowKeys, selectedKey, onSelectKey, onDeselect, wrap]
  )

  return (
    <div
      ref={ref}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg"
    >
      {children}
    </div>
  )
}) as <K extends string>(props: {
  children: ReactNode
  rowKeys: K[]
  selectedKey: K | null
  onSelectKey: (key: K) => void
  onDeselect?: () => void
  wrap?: boolean
  ref?: Ref<HTMLDivElement>
}) => ReactNode
