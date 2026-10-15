/** The sole admitted app overlay. Pure bytes only: never read a candidate from
 * the runner checkout or accept caller-provided replacement content. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
export const contextualTestFontOverlay = Object.freeze({ version: 1,
  path: 'src/components/tiptap-templates/simple/simple-editor.scss',
  beforeSha256: '348eaa5a3199f155b1c7c0859be5fde8aa8947177c4743b18698d2ce79576a0e',
  afterSha256: '18889a60dd730b51644a0368071cbb70e1acf79e70413e3d6001df769aa584a7',
})
export const contextualTestFontOverlaySha256 = sha(JSON.stringify(contextualTestFontOverlay))
const before = Buffer.from('@import url("https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap");\n\n')
const after = Buffer.from('// Use locally available fonts and the existing fallback without a remote fetch.\n')

export function applyContextualTestFontOverlay(path: string, content: Buffer): Buffer {
  assert.equal(path, contextualTestFontOverlay.path)
  assert.equal(sha(content), contextualTestFontOverlay.beforeSha256, 'Unexpected frozen editor font bytes')
  assert(content.subarray(0, before.length).equals(before))
  const transformed = Buffer.concat([after, content.subarray(before.length)])
  assert.equal(sha(transformed), contextualTestFontOverlay.afterSha256, 'Unexpected editor font overlay bytes')
  return transformed
}
