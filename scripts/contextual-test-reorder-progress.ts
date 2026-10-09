/** Inert proof-only delivery observation. No SQL, IO or timing attribution. */
export type TestOwnerReorderProgressScope = 'none' | 'calibration' | 'bulk'
export type TestOwnerReorderProgressCheckpoint = 'none' | 'invalid' | 'PRG01' | 'PRG02' | 'PRG03' | 'PRG04'
export function captureTestOwnerReorderProgress(scope: TestOwnerReorderProgressScope) {
  let line = ''; let discard = false; let invalid = false; let step = 0; let calibrated = false
  function consume() {
    if (!invalid && !discard && line.includes('PRG')) {
      const match = line.match(/^(?:psql:<stdin>:[1-9]\d{0,6}: )?INFO:[ \t]+(PRG0[0-4])[ \t]*\r?$/)
      const code = match?.[1]
      if (scope === 'calibration' && code === 'PRG00' && !calibrated) calibrated = true
      else if (scope === 'bulk' && code === `PRG0${step + 1}` && step < 4) step++
      else invalid = true
    }
    line = ''; discard = false
  }
  return Object.freeze({
    push(chunk: Buffer | string) {
      if (scope === 'none' || invalid) return
      for (const character of chunk.toString()) {
        if (character === '\n') consume()
        else if (!discard) {
          if (character.charCodeAt(0) > 127 || line.length >= 128) { line = ''; discard = true; invalid = true }
          else line += character
        }
      }
    },
    snapshot() {
      return Object.freeze({ checkpoint: (invalid ? 'invalid' : scope === 'bulk' && step ? `PRG0${step}` : 'none') as TestOwnerReorderProgressCheckpoint,
        calibrated: !invalid && calibrated, valid: !invalid })
    },
  })
}
