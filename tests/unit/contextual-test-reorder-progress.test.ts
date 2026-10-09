import { describe, expect, it } from 'vitest'
import { captureTestOwnerReorderProgress } from '../../scripts/contextual-test-reorder-progress'

const info = (code: string) => `INFO: ${code}\n`
describe('bounded source-owned reorder progress observation', () => {
  it('accepts only complete contiguous bulk INFO codes, including split CRLF and bounded stdin prefixes', () => {
    const p = captureTestOwnerReorderProgress('bulk')
    p.push('psql:<stdin>:123: INFO: PR'); expect(p.snapshot().checkpoint).toBe('none')
    p.push('G01\r'); expect(p.snapshot().checkpoint).toBe('none')
    p.push('\nINFO: PRG02\nINFO: PRG03\nINFO: PRG04\n')
    expect(p.snapshot()).toEqual({ checkpoint: 'PRG04', calibrated: false, valid: true })
  })
  it.each(['PRG02', 'PRG99', 'PRG00'])('invalidates unknown, reordered or out-of-scope bulk code %s', code => {
    const p = captureTestOwnerReorderProgress('bulk'); p.push(info(code)); p.push(info('PRG01'))
    expect(p.snapshot()).toEqual({ checkpoint: 'invalid', calibrated: false, valid: false })
  })
  it.each([
    `${info('PRG01')}${info('PRG01')}`, 'INFO: PRG01 private value\n', 'INFO: PRG01\u0000\n',
    `${'x'.repeat(129)}INFO: PRG01\n`, 'psql:/private/secret:1: INFO: PRG01\n',
    'psql:<stdin>:0001: INFO: PRG01\n', 'PRIVATE INFO: PRG01\n', 'INFO: PRG01\rprivate\n',
  ])('cannot forge valid progress from malformed or private input', input => {
    const p = captureTestOwnerReorderProgress('bulk'); p.push(input)
    expect(p.snapshot().checkpoint).not.toBe('PRG01')
    expect(JSON.stringify(p.snapshot())).not.toMatch(/private|secret|PRIVATE/)
  })
  it('calibrates only a single PRG00 in calibration scope', () => {
    const p = captureTestOwnerReorderProgress('calibration'); p.push(info('PRG00'))
    expect(p.snapshot()).toEqual({ checkpoint: 'none', calibrated: true, valid: true })
    p.push(info('PRG00')); expect(p.snapshot().calibrated).toBe(false)
    const wrong = captureTestOwnerReorderProgress('none'); wrong.push(info('PRG00')); wrong.push(info('PRG01'))
    expect(wrong.snapshot()).toEqual({ checkpoint: 'none', calibrated: false, valid: true })
  })
  it.each(['PRD14', '57014', 'ZZ999'])('keeps progress separate from error SQLSTATE %s', code => {
    const p = captureTestOwnerReorderProgress('bulk'); p.push(info('PRG01')); p.push(`ERROR: ${code}\n`)
    expect(p.snapshot().checkpoint).toBe('PRG01')
  })
  it('snapshots are immutable and incomplete final fragments never count', () => {
    const p = captureTestOwnerReorderProgress('bulk'); p.push(info('PRG01'))
    const before = p.snapshot(); p.push('INFO: PRG02'); expect(p.snapshot().checkpoint).toBe('PRG01')
    p.push('\n'); expect(before.checkpoint).toBe('PRG01'); expect(Object.isFrozen(before)).toBe(true)
  })
})
