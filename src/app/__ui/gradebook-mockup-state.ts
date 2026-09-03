// Matches the live assessment-weight contract without persisting prototype edits.
export function isValidGradebookMockupWeight(weight: number): boolean {
  return Number.isInteger(weight) && weight >= 1 && weight <= 999
}
