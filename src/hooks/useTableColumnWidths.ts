import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface TableColumnWidthDefinition {
  defaultWidth: number
  min: number
  max: number
}

type TableColumnWidthDefinitions<K extends string> = Record<K, TableColumnWidthDefinition>
type TableColumnWidths<K extends string> = Record<K, number>

const STORAGE_PREFIX = 'pika:table-widths:'

function clampWidth(definition: TableColumnWidthDefinition, width: number): number {
  return Math.min(definition.max, Math.max(definition.min, Math.round(width)))
}

function getDefaultWidths<K extends string>(
  columns: TableColumnWidthDefinitions<K>,
): TableColumnWidths<K> {
  return Object.fromEntries(
    Object.entries<TableColumnWidthDefinition>(columns).map(([key, definition]) => [
      key,
      definition.defaultWidth,
    ]),
  ) as TableColumnWidths<K>
}

export function useTableColumnWidths<K extends string>({
  storageKey,
  columns,
}: {
  storageKey: string | null
  columns: TableColumnWidthDefinitions<K>
}) {
  const defaultWidths = useMemo(() => getDefaultWidths(columns), [columns])
  const [columnWidths, setColumnWidths] = useState<TableColumnWidths<K>>(defaultWidths)
  const storageReadyRef = useRef(false)

  useEffect(() => {
    storageReadyRef.current = false
    let nextWidths = defaultWidths

    if (storageKey) {
      try {
        const storedValue = window.localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`)
        if (storedValue) {
          const parsed = JSON.parse(storedValue) as Record<string, unknown>
          nextWidths = Object.fromEntries(
            Object.entries<TableColumnWidthDefinition>(columns).map(([key, definition]) => {
              const storedWidth = parsed[key]
              return [
                key,
                typeof storedWidth === 'number' && Number.isFinite(storedWidth)
                  ? clampWidth(definition, storedWidth)
                  : definition.defaultWidth,
              ]
            }),
          ) as TableColumnWidths<K>
        }
      } catch {
        nextWidths = defaultWidths
      }
    }

    setColumnWidths(nextWidths)
    storageReadyRef.current = true
  }, [columns, defaultWidths, storageKey])

  useEffect(() => {
    if (!storageKey || !storageReadyRef.current) return
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, JSON.stringify(columnWidths))
    } catch {
      // Width preferences are optional; storage failures must not affect table use.
    }
  }, [columnWidths, storageKey])

  const setColumnWidth = useCallback((column: K, width: number) => {
    setColumnWidths((current) => ({
      ...current,
      [column]: clampWidth(columns[column], width),
    }))
  }, [columns])

  const resetColumnWidths = useCallback(() => {
    setColumnWidths(defaultWidths)
  }, [defaultWidths])

  return { columnWidths, setColumnWidth, resetColumnWidths }
}
