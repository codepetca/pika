import assert from 'node:assert/strict'

export const contextualTestAuthoringStages = Object.freeze([
  'visit', 'create-click', 'create-response', 'create-status', 'create-body', 'create-identity',
  'editor-open', 'markdown-fill', 'markdown-apply', 'save-confirmation', 'editor-close',
  'reload', 'markdown-readback', 'draft-readback', 'upload-open', 'upload-submit', 'upload-proof',
  'preview-embedded', 'preview-route', 'publish', 'published-readback', 'complete',
] as const)
type Stage = typeof contextualTestAuthoringStages[number]
type Status = 'created' | 'unauthorized' | 'forbidden' | 'not-found' | 'conflict' | 'unavailable' | 'other-http'
type Row = { owner: 'ownerTeacher' | 'ownerStudent'; kind: 'main' | 'single' | 'bulk'; stage: Stage; createStatus: Status | null }
export type ContextualTestAuthoringStep = { mark(stage: Stage, status?: number): void }

/** Diagnostic only; never substitutes for an acknowledgement or workflow check.
 * Keep just one fixed-vocabulary row, not IDs, URLs, body data or exceptions. */
export function createContextualTestAuthoringProgress() {
  let current: Row | null = null
  const seen = new Set<string>()
  return Object.freeze({
    begin(owner: Row['owner'], kind: Row['kind']): ContextualTestAuthoringStep {
      assert(['ownerTeacher', 'ownerStudent'].includes(owner) && ['main', 'single', 'bulk'].includes(kind))
      assert(seen.size < 6 && !seen.has(`${owner}:${kind}`))
      seen.add(`${owner}:${kind}`)
      const row: Row = { owner, kind, stage: 'visit', createStatus: null }; current = row
      return Object.freeze({ mark(stage: Stage, status?: number) {
        assert(current === row && contextualTestAuthoringStages.includes(stage))
        assert(status === undefined || (stage === 'create-status' && Number.isSafeInteger(status) && status >= 100 && status <= 599))
        if (status !== undefined) row.createStatus = status === 201 ? 'created' : status === 401 ? 'unauthorized'
          : status === 403 ? 'forbidden' : status === 404 ? 'not-found' : status === 409 ? 'conflict'
            : status === 503 ? 'unavailable' : 'other-http'
        row.stage = stage
      } })
    },
    snapshot() { return current ? Object.freeze({ ...current }) : null },
  })
}
