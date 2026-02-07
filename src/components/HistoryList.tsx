'use client'

import { HistoryGraph } from '@/components/HistoryGraph'
import type { HistoryGraphProps } from '@/components/HistoryGraph'

/** @deprecated Use HistoryGraph directly. This re-export preserves backward compatibility. */
export type HistoryListProps = HistoryGraphProps

/** @deprecated Use HistoryGraph directly. This re-export preserves backward compatibility. */
export const HistoryList = HistoryGraph
