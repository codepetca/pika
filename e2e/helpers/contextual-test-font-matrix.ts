/** Fixed Pattern Lab references; teacher editing evidence deliberately uses the
 * shared student-editor reference while retaining the teacher's real session. */
import assert from 'node:assert/strict'
import type { ContextualTestRuntime } from './contextual-test-rehearsal'

export const contextualTestFontShots = Object.freeze(
  (['ownerTeacher', 'memberStudent'] as const).flatMap(actor => (['desktop', 'mobile'] as const).flatMap(view =>
    (['light', 'dark'] as const).flatMap(theme => (['preview', 'read-only', 'editing', 'empty'] as const).map(state => {
      const editable = state === 'editing' || state === 'empty'
      return Object.freeze({ label: `font-${actor}-${view}-${theme}-${state}`, actor, view, theme, state,
        selector: editable ? '#student-image-upload[data-testid="student-image-upload-gallery"]' : '#history-preview[data-testid="history-preview-gallery"]',
        referenceRole: editable || actor === 'memberStudent' ? 'student' : 'teacher',
        fontReference: editable ? 'shared-student-editor-reference' : actor === 'ownerTeacher' ? 'teacher-history-viewer' : 'student-history-readonly-editor',
      })
    }))))
)
export function contextualTestFontShot(label: string) {
  const shot = contextualTestFontShots.find(row => row.label === label)
  assert(shot, 'Unknown fixed font screenshot'); return shot
}
export const contextualTestFontEditingText = 'Local font review: evidence, observations, and interpretation.'

export async function runContextualTestFontMatrix(r: ContextualTestRuntime): Promise<void> {
  for (const actor of ['ownerTeacher', 'memberStudent'] as const) await r.withActor(actor, async page => {
    for (const view of ['desktop', 'mobile'] as const) for (const theme of ['light', 'dark'] as const) {
      r.check(); await page.setViewportSize(view === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 })
      await page.emulateMedia({ colorScheme: theme })
      await page.evaluate(value => localStorage.setItem('theme', value), theme)
      const referenceRole = actor === 'ownerTeacher' ? 'teacher' : 'student'
      await r.navigate(page, `${r.plan.appOrigin}/pattern-lab?role=${referenceRole}#history-preview`, 'load')
      const history = page.locator('#history-preview[data-testid="history-preview-gallery"]')
      await history.getByRole('button', { name: 'Exit preview', exact: true }).waitFor({ state: 'visible' })
      await r.captureFont(`font-${actor}-${view}-${theme}-preview`, page)
      await history.getByRole('button', { name: 'Exit preview', exact: true }).click()
      await history.getByRole('button', { name: 'Exit preview', exact: true }).waitFor({ state: 'detached' })
      await r.captureFont(`font-${actor}-${view}-${theme}-read-only`, page)
      await r.navigate(page, `${r.plan.appOrigin}/pattern-lab?role=student#student-image-upload`, 'load')
      const editor = page.locator('#student-image-upload[data-testid="student-image-upload-gallery"] .tiptap.ProseMirror[contenteditable="true"]')
      await editor.waitFor({ state: 'visible' }); await editor.fill(contextualTestFontEditingText)
      await r.captureFont(`font-${actor}-${view}-${theme}-editing`, page)
      await editor.fill('')
      await r.captureFont(`font-${actor}-${view}-${theme}-empty`, page)
    }
  })
}
