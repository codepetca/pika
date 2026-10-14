/** Coordinator explicit-call entry only. No CLI, native launch or I/O on import.
 * Review/authority remains with the caller; digests are identity, not permission.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { captureContextualTestDependencies, contextualTestReadOnlyDependencyProfile, immutableContextualTestData, verifyContextualTestBinary } from './contextual-test-rehearsal-launch'
import { createContextualTestNativeControls, type ContextualTestNativePins, type ContextualTestOwnedChild } from './contextual-test-rehearsal-native'
import { assertDiagnosticPrivateUmask, assertDiagnosticRunnerOutputModes, diagnosticDirectory, diagnosticHash, diagnosticRead, diagnosticReportPassed, diagnosticSourceFiles, diagnosticWrite,
  DIAGNOSTIC_CHROME, DIAGNOSTIC_CHROME_SHA, DIAGNOSTIC_VERSION, type DiagnosticAdmission } from './contextual-browser-diagnostic-data'

export type BrowserDiagnosticInput = {
  repository: string; outputDir: string; pins: ContextualTestNativePins
  sourceSha256: Readonly<Record<string, string>>
  dependencies: { root: string; sha256: string }
}
type Stage = 'preflight' | 'browser' | 'cleanup' | 'receipt' | 'complete'
const fixedFailure = () => new Error('Private browser diagnostic failed; consult fixed private receipts')

/** One call, one exclusive spent token, one original clock, one browser child.
 * No Docker/Supabase/app/native readiness helper or full controller is invoked.
 * The inherited sandbox only denies dependency writes. Offline routing protects
 * this diagnostic context; this is not a claim of zero OS-wide browser egress.
 */
export async function runContextualBrowserDiagnostic(input: BrowserDiagnosticInput) {
  assertDiagnosticPrivateUmask(process.umask())
  input = immutableContextualTestData(input)
  diagnosticDirectory(input.outputDir); assert.equal(readdirSync(input.outputDir).length, 0)
  assert.equal(realpathSync(input.repository), input.repository)
  assert.equal(realpathSync(input.dependencies.root), input.dependencies.root)
  assert.equal(input.pins.outputDir, input.outputDir)
  assert.equal(realpathSync(process.execPath), input.pins.node.path)
  assert.equal(input.pins.node.path, '/Users/stew/.local/share/mise/installs/node/24.12.0/bin/node')
  assert.equal(input.pins.node.sha256, '90ee1d271eec831fd38d16c78c19cc36809548ac5cd034a6e0c10c4389c881ef')
  assert.equal(process.version, 'v24.12.0')
  assert.equal(input.pins.chrome.path, DIAGNOSTIC_CHROME); assert.equal(input.pins.chrome.sha256, DIAGNOSTIC_CHROME_SHA)
  assert.equal(input.pins.helper.path, join(input.repository, 'scripts/contextual-test-process-identity.py'))
  assert.equal(JSON.parse(readFileSync(join(input.dependencies.root, '@playwright/test/package.json'), 'utf8')).version, '1.58.0')
  const sourceCheck = () => {
    assert.deepEqual(Object.keys(input.sourceSha256).sort(), [...diagnosticSourceFiles].sort())
    for (const file of diagnosticSourceFiles) {
      assert(/^[a-f0-9]{64}$/.test(input.sourceSha256[file]))
      const path = join(input.repository, file), before = lstatSync(path)
      assert(before.isFile() && !before.isSymbolicLink() && realpathSync(path) === path)
      assert.equal(diagnosticHash(readFileSync(path)), input.sourceSha256[file])
      const after = lstatSync(path)
      assert(before.ino === after.ino && before.dev === after.dev && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs)
    }
    for (const key of ['node','ps','python','lsof','sandbox','codesign','chrome','helper'] as const) verifyContextualTestBinary(input.pins[key])
  }
  sourceCheck()
  // Data preparation has no native dispatch and allocates no attempt clock.
  const dependencies = captureContextualTestDependencies(input.dependencies.root, Date.now() + 30000)
  assert.equal(dependencies.sha256, input.dependencies.sha256)
  const profile = contextualTestReadOnlyDependencyProfile(dependencies.roots)
  mkdirSync(join(input.outputDir, 'tmp'), { mode: 0o700 })
  mkdirSync(join(input.outputDir, 'runner-output'), { mode: 0o700 })
  const startedAt = Date.now(), deadline = startedAt + 90000, cleanupDeadline = deadline + 360000
  const admission: DiagnosticAdmission = { version: 1, nonce: randomBytes(16).toString('hex'), outputDir: input.outputDir, startedAt, deadline, cleanupDeadline }
  diagnosticWrite(input.outputDir, 'admission.json', admission)
  diagnosticWrite(input.outputDir, 'spent.json', { version: 1, nonce: admission.nonce, startedAt })
  const native = createContextualTestNativeControls(input.pins, cleanupDeadline)
  let stage: Stage = 'preflight', failedStage: Stage | null = null, owned: ContextualTestOwnedChild | undefined
  let cleanupStartedAt = 0, cleanupEnd = cleanupDeadline, ownedSettled = false, unchanged = false, reportPassed = false, lifecyclePassed = false
  const fail = () => { failedStage ??= stage }
  const workCheck = () => assert(Date.now() < deadline)
  try {
    assert.equal(await native.probe(input.pins.node, ['--version'], deadline), 'v24.12.0')
    await native.probe(input.pins.codesign, ['--verify','--deep','--strict', dirname(dirname(dirname(input.pins.chrome.path)))], deadline)
    // Probe actual write denial against an existing package, without writing.
    const script = "const f=require('node:fs');try{const d=f.openSync(process.argv[1],f.constants.O_WRONLY);f.closeSync(d);process.exit(7)}catch(e){process.exit(e.code==='EPERM'||e.code==='EACCES'?0:8)}"
    await native.probe(input.pins.sandbox, ['-p',profile,input.pins.node.path,'-e',script,realpathSync(join(input.dependencies.root, '@playwright/test/package.json'))], deadline)
    sourceCheck(); assert.equal(captureContextualTestDependencies(input.dependencies.root, Math.min(deadline, Date.now() + 30000)).sha256, dependencies.sha256); workCheck()
    const file = join(input.outputDir, 'admission.json'), digest = diagnosticHash(readFileSync(file))
    const env = { PATH: '/usr/bin:/bin', TZ: 'America/Toronto', LANG: 'C', LC_ALL: 'C', NEXT_TELEMETRY_DISABLED: '1',
      NODE_ENV: 'development', HOME: input.outputDir, TMPDIR: join(input.outputDir, 'tmp'),
      PIKA_BROWSER_DIAGNOSTIC: 'true', PIKA_BROWSER_DIAGNOSTIC_FILE: file, PIKA_BROWSER_DIAGNOSTIC_SHA256: digest }
    stage = 'browser'
    owned = await native.spawnOwned({ role: 'browser', cwd: input.repository, profile, env,
      args: [join(input.dependencies.root, '@playwright/test/cli.js'), 'test', `--config=${join(input.repository, 'playwright.contextual-browser-diagnostic.config.ts')}`, 'contextual-browser-diagnostic.spec.ts'],
      deadline: Math.min(deadline, Date.now() + 30000) })
    diagnosticWrite(input.outputDir, 'owned-ready.json', { version: 1, nonce: admission.nonce })
    await owned.wait(); workCheck()
  } catch { fail() }
  finally {
    stage = 'cleanup'; cleanupStartedAt = Date.now(); cleanupEnd = Math.min(cleanupDeadline, cleanupStartedAt + 360000)
    try { await native.settleAll(cleanupEnd); native.assertClosed(); ownedSettled = owned !== undefined && owned.state().closed && !owned.state().uncertain }
    catch { fail() }
    try {
      assert(Date.now() < cleanupEnd); sourceCheck()
      assert.equal(captureContextualTestDependencies(input.dependencies.root, Math.min(cleanupEnd, Date.now() + 30000)).sha256, dependencies.sha256)
      assert(Date.now() < cleanupEnd); unchanged = true
    } catch { fail() }
    stage = 'receipt'
    try {
      assertDiagnosticRunnerOutputModes(input.outputDir)
      reportPassed = diagnosticReportPassed(JSON.parse(diagnosticRead(join(input.outputDir, 'report.json'))))
      const lifecycle = JSON.parse(diagnosticRead(join(input.outputDir, 'lifecycle.json')))
      assert.deepEqual(Object.keys(lifecycle).sort(), ['blankPageCreated','blockedRequests','contextClosed','contextCreated','fixtureEntered','version','versionMatched'])
      lifecyclePassed = lifecycle.version === 1 && lifecycle.fixtureEntered === true && lifecycle.versionMatched === true && lifecycle.contextCreated === true
        && lifecycle.blankPageCreated === true && lifecycle.contextClosed === true && lifecycle.blockedRequests === 0
      assert(reportPassed && lifecyclePassed)
    } catch { fail() }
  }
  stage = 'complete'
  const receipt = { version: 1, outcome: failedStage === null && ownedSettled && unchanged && reportPassed && lifecyclePassed ? 'passed' : 'failed',
    failedStage, startedAt, deadline, cleanupDeadline, cleanupStartedAt, cleanupEnd, endedAt: Date.now(),
    ownedBirthCaptured: owned !== undefined, ownedSettled, unchanged, reportPassed, lifecyclePassed,
    nodeVersion: 'v24.12.0', playwrightVersion: '1.58.0', chromeVersion: DIAGNOSTIC_VERSION,
    sourceManifestSha256: diagnosticHash(JSON.stringify(input.sourceSha256)), dependencySha256: dependencies.sha256,
    networkScope: 'offline-context-and-all-route-abort; inherited-sandbox-is-not-global-egress-isolation' }
  diagnosticWrite(input.outputDir, 'controller.json', receipt)
  if (receipt.outcome !== 'passed') throw fixedFailure()
  return receipt
}
