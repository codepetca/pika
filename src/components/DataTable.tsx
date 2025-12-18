'use client'

import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline'

export type DataTableDensity = 'compact' | 'normal'
export type SortDirection = 'asc' | 'desc'

function densityPadding(density: DataTableDensity) {
  return density === 'compact' ? 'px-4 py-2' : 'px-4 py-3'
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
  const Icon = direction === 'asc' ? ChevronUpIcon : ChevronDownIcon

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
        {isActive ? <Icon className="h-4 w-4 text-gray-500 dark:text-gray-400" aria-hidden="true" /> : null}
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
