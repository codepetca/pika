type TestResponseLike = {
  selected_option?: unknown
  response_text?: unknown
}

export function hasMeaningfulTestResponse(response: TestResponseLike | null | undefined): boolean {
  if (!response) return false

  if (typeof response.selected_option === 'number') {
    return Number.isFinite(response.selected_option) && response.selected_option >= 0
  }

  if (typeof response.response_text === 'string') {
    return response.response_text.trim().length > 0
  }

  return false
}

export function hasAnyMeaningfulTestResponse(
  responses: ReadonlyArray<TestResponseLike> | null | undefined
): boolean {
  return (responses || []).some((response) => hasMeaningfulTestResponse(response))
}
