/** The returned-only student contract; never exposes the teacher Gradebook payload. */
export interface ReturnedGradebookItem {
  id: string
  title: string
  earned: number
  possible: number
  percent: number
  categoryName: string | null
  included: boolean
}

export interface ReturnedGradebookItemsResponse {
  items: ReturnedGradebookItem[]
}
