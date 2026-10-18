import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { captureSurveyProgress, SURVEY_PROGRESS_CAPS, SURVEY_PROGRESS_EVENTS } from '../../scripts/contextual-surveys-progress'
const line = (n: number) => `psql:<stdin>:700: INFO:  PS${String(n).padStart(3, '0')}\n`
describe('closed Survey rollback progress, offline only', () => {
  it('maps exactly49 cases with four stages and fixed fixture boundaries under the existing byte cap', () => {
    expect(SURVEY_PROGRESS_EVENTS).toHaveLength(211)
    expect(SURVEY_PROGRESS_EVENTS.filter(e => e.endsWith(':rpc-start'))).toHaveLength(49)
    expect(new Set(SURVEY_PROGRESS_EVENTS).size).toBe(211)
    expect(SURVEY_PROGRESS_CAPS).toEqual({ events:224,lineBytes:128,maximumBytes:28672 })
    let now = 100
    const p = captureSurveyProgress(true, () => now)
    for (let n=1;n<=211;n++) { now++; const text=line(n); expect(Buffer.byteLength(text)).toBeLessThan(128); for(const c of text) p.push(c) }
    expect(p.finish()).toEqual({ enabled:true,valid:true,sequence:211,checkpoint:'matrix:complete',elapsedMs:211 })
  })
  it.each([line(2), line(1)+line(1), line(1)+line(3), 'INFO: PS999\n', 'INFO: PS001 secret\n', 'INFO: garbage\n', 'INFO: PS001'+ 'x'.repeat(128)+'\n', 'INFO: PS001é\n'])('rejects malformed/duplicate/order/bound violations without retaining payload: %s', text => {
    const p=captureSurveyProgress(true,()=>0);p.push(text)
    expect(p.snapshot().valid).toBe(false);expect(JSON.stringify(p.snapshot())).not.toMatch(/secret|garbage|xxxxx|é/)
  })
  it('freezes last valid progress on first failure and ignores settlement chunks', () => {
    let now=10;const p=captureSurveyProgress(true,()=>now)
    now=12;p.push(line(1));p.push('INFO: PS003\n');const first=p.freeze()
    now=100;p.push(line(2));expect(p.finish()).toEqual(first)
    expect(first).toEqual({ enabled:true,valid:false,sequence:1,checkpoint:'functional:start',elapsedMs:2 })
  })
  it('ignores unrelated errors, rejects truncated completion, and leaves other frames inert', () => {
    const p=captureSurveyProgress(true,()=>0);p.push('ERROR: 57014\n');expect(p.snapshot().valid).toBe(true)
    p.push('INFO: PS001');expect(p.finish().valid).toBe(false)
    const off=captureSurveyProgress(false,()=>{throw Error('not called')});off.push('private data'.repeat(100));expect(off.finish()).toEqual({enabled:false,valid:true,sequence:0,checkpoint:'none',elapsedMs:null})
  })
  it('rejects a clock regression and missing terminal markers',()=>{
    let now=10;const p=captureSurveyProgress(true,()=>now);now=11;p.push(line(1));now=9;p.push(line(2));expect(p.snapshot().valid).toBe(false)
    expect(captureSurveyProgress(true,()=>0).finish().valid).toBe(false)
  })
  it('scopes engine telemetry to exact component SQL and both contract phase names; charges before parsing and freezes first fault',()=>{
    const source=readFileSync('scripts/contextual-test-draft-save-native-contracts.ts','utf8')
    expect(source).toContain("(phase === 'contracts' || phase === 'transitions') && sql === profile.surveyProgressSql")
    expect(source).toContain("surveyProgressSql: manifest.contracts.sql")
    expect(source.indexOf('chargeComponent(chunk.length, this.cleaning)',source.indexOf("this.child.stderr.on"))).toBeLessThan(source.indexOf('this.surveyProgressCapture.push(chunk)'))
    expect(source).toContain('if (firstFault) return\n    for (const session of sessions)')
    expect(source).toContain('surveyProgress = session.freezeSurveyProgress()')
    expect(source).toContain("this.surveyProgressCapture.finish().valid")
    expect(source).not.toContain('VERBOSITY=verbose')
  })
})
