import type { FullResult, Reporter, Suite, TestCase, TestError, TestResult } from '@playwright/test/reporter'
import { classifyDiagnosticError, type DiagnosticReport } from '../../scripts/contextual-browser-diagnostic-data'
import { contextualTestStartupBinding, createContextualTestStartup, writeFullStartupReport } from './contextual-test-startup'

/** Sole reporter: never prints errors, titles, paths, attachments or captured I/O. */
export default class ContextualTestStartupReporter implements Reporter {
  private binding = contextualTestStartupBinding()
  private startup = createContextualTestStartup(this.binding)
  private report: DiagnosticReport = { version: 1, status: 'failed', discovered: 0, started: 0, ended: 0, passed: 0, errors: [], overflow: false }
  // Claim stdio ownership so Playwright does not add a console reporter.
  printsToStdio() { return true }
  private count(key: 'discovered' | 'started' | 'ended' | 'passed', amount = 1) {
    if (this.report[key] + amount > 2) this.report.overflow = true
    this.report[key] = Math.min(2, this.report[key] + amount)
  }
  private error(error: TestError) {
    if (this.report.errors.length === 8) this.report.overflow = true
    else this.report.errors.push(classifyDiagnosticError(error))
  }
  onBegin(_config: unknown, suite: Suite) { this.count('discovered', suite.allTests().length); this.startup.stage('collection') }
  onTestBegin() { this.count('started'); this.startup.stage('fixture') }
  onTestEnd(_test: TestCase, result: TestResult) {
    this.count('ended'); if (result.status === 'passed') this.count('passed')
    if (result.errors.length > 8) this.report.overflow = true
    for (const error of result.errors.slice(0, 8)) this.error(error)
  }
  onError(error: TestError) { this.error(error) }
  onEnd(result: FullResult) {
    this.report.status = result.status
    try { writeFullStartupReport(this.binding, this.report) }
    catch { throw new Error('Private contextual Test startup report unavailable') }
  }
}
