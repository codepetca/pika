/** Coordinator explicit-call entry only. No CLI, native launch or I/O on import.
 * Review/authority remains with the caller; digests are identity, not permission.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { BrowserStartupJournal, BrowserStartupStage } from './contextual-browser-startup'
import { captureContextualTestDependencies, contextualTestReadOnlyDependencyProfile, immutableContextualTestData, verifyContextualTestBinary } from './contextual-test-rehearsal-launch'
import { createContextualTestNativeControls, type ContextualTestNativePins, type ContextualTestOwnedChild } from './contextual-test-rehearsal-native'
import { assertDiagnosticPrivateUmask, assertDiagnosticRunnerOutputModes, diagnosticDirectory, diagnosticHash, diagnosticRead, diagnosticReportPassed, diagnosticSourceFiles, diagnosticWrite, navigationLifecyclePassed,
  DIAGNOSTIC_CHROME, DIAGNOSTIC_CHROME_SHA, DIAGNOSTIC_VERSION, type DiagnosticAdmission } from './contextual-browser-diagnostic-data'

export type BrowserDiagnosticInput = {
  repository: string; outputDir: string; pins: ContextualTestNativePins
  sourceSha256: Readonly<Record<string, string>>
  dependencies: { root: string; sha256: string }
  mode?: DiagnosticAdmission['mode']
}
type Stage = 'preflight' | 'browser' | 'cleanup' | 'receipt' | 'complete'
const fixedFailure = () => new Error('Private browser diagnostic failed; consult fixed private receipts')

/** One call, one exclusive spent token, one original clock, one browser child.
 * No Docker/Supabase/app/native readiness helper or full controller is invoked.
 * The inherited sandbox only denies dependency writes. Offline routing protects
 * this diagnostic context; this is not a claim of zero OS-wide browser egress.
 */
export async function runContextualBrowserDiagnostic(input: BrowserDiagnosticInput, startup?: BrowserStartupJournal) {
  const step = <T>(stage: BrowserStartupStage, work: () => T | Promise<T>) => startup ? startup.step(stage, work) : Promise.resolve().then(work)
  input = await step('runtime-input', () => {
    assertDiagnosticPrivateUmask(process.umask())
    const snapshot = immutableContextualTestData(input)
    assert(snapshot.mode === undefined || snapshot.mode === 'login-body' || snapshot.mode === 'navigation-lifecycle')
    diagnosticDirectory(snapshot.outputDir); assert.equal(readdirSync(snapshot.outputDir).length, 0)
    assert.equal(realpathSync(snapshot.repository), snapshot.repository)
    assert.equal(realpathSync(snapshot.dependencies.root), snapshot.dependencies.root)
    assert.equal(snapshot.pins.outputDir, snapshot.outputDir)
    assert.equal(realpathSync(process.execPath), snapshot.pins.node.path)
    assert.equal(snapshot.pins.node.path, '/Users/stew/.local/share/mise/installs/node/24.12.0/bin/node')
    assert.equal(snapshot.pins.node.sha256, '90ee1d271eec831fd38d16c78c19cc36809548ac5cd034a6e0c10c4389c881ef')
    assert.equal(process.version, 'v24.12.0')
    assert.equal(snapshot.pins.chrome.path, DIAGNOSTIC_CHROME); assert.equal(snapshot.pins.chrome.sha256, DIAGNOSTIC_CHROME_SHA)
    assert.equal(snapshot.pins.helper.path, join(snapshot.repository, 'scripts/contextual-test-process-identity.py'))
    assert.equal(JSON.parse(readFileSync(join(snapshot.dependencies.root, '@playwright/test/package.json'), 'utf8')).version, '1.58.0')
    return snapshot
  })
  const sourceFilesCheck = () => {
    assert.deepEqual(Object.keys(input.sourceSha256).sort(), [...diagnosticSourceFiles].sort())
    for (const file of diagnosticSourceFiles) {
      assert(/^[a-f0-9]{64}$/.test(input.sourceSha256[file]))
      const path = join(input.repository, file), before = lstatSync(path)
      assert(before.isFile() && !before.isSymbolicLink() && realpathSync(path) === path)
      assert.equal(diagnosticHash(readFileSync(path)), input.sourceSha256[file])
      const after = lstatSync(path)
      assert(before.ino === after.ino && before.dev === after.dev && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs)
    }
  }
  const binaryKeys = ['node','ps','python','lsof','sandbox','codesign','chrome','helper'] as const
  const sourceCheck = () => { sourceFilesCheck(); for (const key of binaryKeys) verifyContextualTestBinary(input.pins[key]) }
  await step('source-files', sourceFilesCheck)
  for (const key of binaryKeys) await step(`pin-${key}`, () => verifyContextualTestBinary(input.pins[key]))
  // Data preparation has no native dispatch and allocates no attempt clock.
  const dependencies = await step('runtime-dependencies', () => {
    const result = captureContextualTestDependencies(input.dependencies.root, Date.now() + 30000)
    assert.equal(result.sha256, input.dependencies.sha256)
    return result
  })
  const profile = await step('runtime-profile', () => contextualTestReadOnlyDependencyProfile(dependencies.roots))
  const admission = await step('runtime-admission', () => {
    mkdirSync(join(input.outputDir, 'tmp'), { mode: 0o700 })
    mkdirSync(join(input.outputDir, 'runner-output'), { mode: 0o700 })
    const startedAt = Date.now(), deadline = startedAt + 90000, cleanupDeadline = deadline + 360000
    const admission: DiagnosticAdmission = { version: 1, nonce: randomBytes(16).toString('hex'), outputDir: input.outputDir, startedAt, deadline, cleanupDeadline,
      ...(input.mode !== undefined ? { mode: input.mode } : {}) }
    diagnosticWrite(input.outputDir, 'admission.json', admission)
    diagnosticWrite(input.outputDir, 'spent.json', { version: 1, nonce: admission.nonce, startedAt })
    return admission
  })
  const { startedAt, deadline, cleanupDeadline } = admission
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
      if (input.mode === 'navigation-lifecycle') {
        lifecyclePassed = navigationLifecyclePassed(lifecycle)
      } else if (input.mode === 'login-body') {
        assert.deepEqual(Object.keys(lifecycle).sort(), ['atCutoff','bodyDone','bodySettled','bodyVerified','contextClosed','diagnosticOnly','events','failure','fetchHeld','mode','navigationHeld',
          'originalSeen','overflow','pageErrors','posts','requestFinished','requests','serverClosed','socketsRemaining','unexpectedRequests','version','versionMatched'].sort())
        lifecyclePassed = lifecycle.version === 1 && lifecycle.mode === 'login-body' && lifecycle.versionMatched === true && lifecycle.diagnosticOnly === true
          && lifecycle.contextClosed === true && lifecycle.serverClosed === true && lifecycle.socketsRemaining === 0 && lifecycle.unexpectedRequests === 0
          && lifecycle.originalSeen === true && lifecycle.bodyDone === true && lifecycle.bodyVerified === true && lifecycle.failure === false && lifecycle.overflow === false
          && lifecycle.fetchHeld === true && lifecycle.navigationHeld === false && lifecycle.atCutoff?.bodyVerified === true
          && lifecycle.posts === 1 && Number.isInteger(lifecycle.requests) && lifecycle.requests >= 2 && lifecycle.requests <= 3
      } else {
        assert.deepEqual(Object.keys(lifecycle).sort(), ['blankPageCreated','blockedRequests','contextClosed','contextCreated','fixtureEntered','version','versionMatched'])
        lifecyclePassed = lifecycle.version === 1 && lifecycle.fixtureEntered === true && lifecycle.versionMatched === true && lifecycle.contextCreated === true
          && lifecycle.blankPageCreated === true && lifecycle.contextClosed === true && lifecycle.blockedRequests === 0
      }
      assert(reportPassed && lifecyclePassed)
    } catch { fail() }
  }
  stage = 'complete'
  const receipt = { version: 1, outcome: failedStage === null && ownedSettled && unchanged && reportPassed && lifecyclePassed ? 'passed' : 'failed',
    failedStage, startedAt, deadline, cleanupDeadline, cleanupStartedAt, cleanupEnd, endedAt: Date.now(),
    ownedBirthCaptured: owned !== undefined, ownedSettled, unchanged, reportPassed, lifecyclePassed,
    nativeDiagnostics: native.diagnostics(), diagnosticOnly: true,
    nodeVersion: 'v24.12.0', playwrightVersion: '1.58.0', chromeVersion: DIAGNOSTIC_VERSION,
    sourceManifestSha256: diagnosticHash(JSON.stringify(input.sourceSha256)), dependencySha256: dependencies.sha256,
    networkScope: input.mode === 'navigation-lifecycle' ? 'one-synthetic-loopback-navigation;3-requests;1-json;no-app-db-accounts;context-route-allowlist;not-global-egress-isolation'
      : input.mode === 'login-body' ? 'one-synthetic-loopback-login;3-requests;no-app-db-accounts;context-route-allowlist;not-global-egress-isolation'
      : 'offline-context-and-all-route-abort; inherited-sandbox-is-not-global-egress-isolation' }
  diagnosticWrite(input.outputDir, 'controller.json', receipt)
  if (receipt.outcome !== 'passed') throw fixedFailure()
  return receipt
}
