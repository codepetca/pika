import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const output = process.argv[2]
if (!output) throw new Error('Pass an absolute artifact directory')
const baseUrl = 'http://localhost:3270'
const variants = ['planned-long', 'planned-final', 'planned-empty', 'actual-long', 'actual-tests', 'actual-empty', 'actual-resources']
const files = ['src/app/e2e-fixtures/public-reading/page.tsx', 'src/app/__ui/UiGallery.tsx', 'src/app/layout.tsx', 'src/contexts/ThemeContext.tsx', 'src/components/tiptap-node/code-block-node/code-block-node.scss', 'src/components/tiptap-templates/simple/simple-editor.scss', 'package.json', 'pnpm-lock.yaml', 'src/app/planned/[slug]/page.tsx', 'src/app/planned/PlannedCourseDocument.tsx', 'src/app/e2e-fixtures/public-reading/page.tsx', 'src/app/e2e-fixtures/public-reading/data.ts', 'src/components/CourseGuideView.tsx', 'src/components/LimitedMarkdown.tsx', 'src/components/editor/RichTextViewer.tsx', 'src/lib/server/course-sites.ts', 'src/lib/limited-markdown.ts', 'src/app/globals.scss', 'src/styles/_variables.scss', 'src/ui/Page.tsx', 'scripts/verify-public-reading-stress.mjs']
mkdirSync(output, { recursive: true })
function bookend(stage) {
  const evidence = { at: new Date().toISOString(), node: process.version, baseUrl,
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    tree: execFileSync('git', ['write-tree'], { encoding: 'utf8' }).trim(),
    status: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }),
    source: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')])) }
  writeFileSync(path.join(output, `${stage}-bookend.json`), JSON.stringify(evidence, null, 2))
  return evidence
}
const before = bookend('before')
if (before.status) throw new Error('Native witness requires a clean committed source tree')
const browser = await chromium.launch()
const cases = []
let contextsOpened = 0; let contextsClosed = 0
const runtime = { playwright: JSON.parse(readFileSync(new URL('../node_modules/@playwright/test/package.json', import.meta.url))).version, node: process.version, chromium: browser.version() }
function requireEvidence(condition, message) { if (!condition) throw new Error(message) }
async function measure(page) {
  return page.evaluate(() => {
    const h1 = document.querySelector('h1'); const title = h1?.getBoundingClientRect()
    const styles = h1 && getComputedStyle(h1)
    return {
      documentWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth,
      documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      title: h1?.textContent, titleRect: title && { x: title.x, y: title.y, width: title.width, height: title.height },
      titleScrollWidth: h1?.scrollWidth, titleClientWidth: h1?.clientWidth,
      fullVisibleTitle: Boolean(h1 && h1.scrollWidth <= h1.clientWidth + 1),
      titleOverflow: styles && { overflow: styles.overflow, textOverflow: styles.textOverflow, whiteSpace: styles.whiteSpace },
      sections: Array.from(document.querySelectorAll('section[id]')).map(el => el.id),
      navTargets: Array.from(document.querySelectorAll('nav[aria-label="Course sections"] a')).map(el => el.getAttribute('href').slice(1)),
      editors: document.querySelectorAll('.tiptap.ProseMirror').length,
      codes: Array.from(document.querySelectorAll('pre')).map(el => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, overflowX: getComputedStyle(el).overflowX, whiteSpace: getComputedStyle(el).whiteSpace })),
      overflowing: Array.from(document.querySelectorAll('main *')).filter(el => el.scrollWidth > el.clientWidth + 1).map(el => ({ tag: el.tagName, class: el.className, client: el.clientWidth, scroll: el.scrollWidth, overflowX: getComputedStyle(el).overflowX })).slice(0, 30),
      hash: location.hash, scrollY, bodyHeight: document.body.scrollHeight,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
      darkClass: document.documentElement.classList.contains('dark'),
    }
  })
}
try {
  const tasks = []
  for (const width of [320, 390]) for (const theme of ['light', 'dark']) for (const motion of ['no-preference', 'reduce']) for (const variant of variants) tasks.push({ width, theme, motion, variant, role: 'public' })
  for (const role of ['teacher', 'student']) for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) for (const motion of ['no-preference', 'reduce']) for (const variant of ['actual-long', 'actual-tests']) tasks.push({ width, theme, motion, variant, role })
  for (const { width, theme, motion, variant, role } of tasks) {
    const id = `${role}-${variant}-${width}-${theme}-${motion}`
    const media = path.join(output, id); mkdirSync(media, { recursive: true })
    const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: theme, reducedMotion: motion, recordVideo: { dir: media, size: { width, height: 844 } } })
    contextsOpened++
    await context.addInitScript(theme => { localStorage.setItem('pika-theme', theme); localStorage.setItem('theme', theme) }, theme)
    const page = await context.newPage(); const logs = { console: [], pageerrors: [], requests: [] }
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) logs.console.push({ type: message.type(), text: message.text() }) })
    page.on('pageerror', error => logs.pageerrors.push(error.message))
    page.on('response', response => { if (response.status() >= 400 || response.url().includes('/api/')) logs.requests.push({ url: response.url(), status: response.status() }) })
    const result = { id, variant, width, theme, motion, role, logs, finalReachable: false, contentBearing: !variant.includes('empty') && variant !== 'actual-resources' }
    try {
      const response = await page.goto(`${baseUrl}/e2e-fixtures/public-reading?variant=${variant}${role === 'public' ? '' : `&role=${role}`}`, { waitUntil: 'networkidle' })
      result.httpStatus = response.status()
      await page.locator('h1').waitFor()
      if (variant === 'planned-long' || variant === 'planned-final') {
        const expected = variant === 'planned-long' ? 5 : 1
        await page.waitForFunction(expected => document.querySelectorAll('.tiptap.ProseMirror').length === expected, expected)
        await page.getByText('FINAL LESSON SENTINEL: reflect on evidence and communicate your next investigation.', { exact: true }).waitFor()
      }
      result.ready = await measure(page)
      result.themeClass = await page.locator('html').getAttribute('class')
      await page.screenshot({ path: path.join(media, 'initial.png'), fullPage: true })
      await page.screenshot({ path: path.join(media, 'top.png') })
      if (variant.startsWith('planned-') && variant !== 'planned-empty') {
        result.keyboard = []
        for (let step = 0; step < 20; step++) {
          await page.keyboard.press('Tab')
          const active = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent, href: document.activeElement?.getAttribute('href') }))
          result.keyboard.push(active)
          if (active.href === '#lesson-sequence') { await page.screenshot({ path: path.join(media, 'focus.png') }); await page.keyboard.press('Enter'); break }
        }
        await page.waitForTimeout(250)
        result.afterEnter = await measure(page)
      }
      const sentinel = variant.includes('planned') ? 'FINAL LESSON SENTINEL: reflect on evidence and communicate your next investigation.' : 'FINAL TEST SENTINEL: Community inquiry reflection'
      if (result.contentBearing) {
        const final = page.getByText(sentinel, { exact: true })
        for (let step = 0; step < 60; step++) {
          const bounds = await final.boundingBox()
          if (bounds && bounds.y >= 0 && bounds.y + bounds.height <= 844) { result.finalReachable = true; break }
          await page.mouse.wheel(0, 700)
          await page.waitForTimeout(50)
        }
        result.finalBounds = await final.boundingBox()
      }
      result.final = await measure(page)
      await page.screenshot({ path: path.join(media, 'final.png') })
      result.navMatchesSections = JSON.stringify(result.ready.navTargets) === JSON.stringify(result.ready.sections)
      result.emptyStatus = await page.getByText('Course guide details are being prepared.', { exact: true }).count()
      requireEvidence(result.httpStatus === 200, 'Fixture did not return HTTP200')
      requireEvidence(result.ready.reducedMotion === (motion === 'reduce'), 'Effective reduced motion mismatch')
      requireEvidence(result.ready.prefersDark === (theme === 'dark') && result.ready.darkClass === (theme === 'dark'), 'Effective theme mismatch')
      requireEvidence(!result.ready.documentOverflow && !result.final.documentOverflow, 'Document overflow')
      requireEvidence(result.ready.fullVisibleTitle, 'Full course title is clipped')
      requireEvidence(!result.contentBearing || result.finalReachable, 'Final content was not reached')
      if (variant.startsWith('planned-')) requireEvidence(result.navMatchesSections, 'Planned nav/section mismatch')
      if (result.afterEnter) requireEvidence(result.afterEnter.hash === '#lesson-sequence', 'Native final hash mismatch')
      requireEvidence(logs.pageerrors.length === 0 && !logs.console.some(message => message.type === 'error') && logs.requests.length === 0, 'Unexpected runtime/API/HTTP error')
    } catch (error) { result.failure = String(error); await page.screenshot({ path: path.join(media, 'failure.png') }).catch(() => {}) }
    finally { await context.close(); contextsClosed++ }
    cases.push(result)
    writeFileSync(path.join(output, 'cases.json'), JSON.stringify(cases, null, 2))
    process.stdout.write(`${id}: ${result.failure || `overflow=${result.ready.documentOverflow}, title=${result.ready.fullVisibleTitle}, final=${result.finalReachable ?? 'n/a'}`}\n`)
  }
} finally { await browser.close() }
const after = bookend('after')
const summary = { before, after, runtime, contextsOpened, contextsClosed,
  roles: Object.fromEntries(['public', 'teacher', 'student'].map(role => [role, cases.filter(item => item.role === role).length])),
  sourceUnchanged: JSON.stringify(before.source) === JSON.stringify(after.source),
  cases: cases.length, failures: cases.filter(item => item.failure).length,
  documentOverflow: cases.filter(item => item.ready?.documentOverflow).map(item => item.id),
  clippedTitles: cases.filter(item => item.ready && !item.ready.fullVisibleTitle).map(item => item.id),
  finalUnreachable: cases.filter(item => item.contentBearing && !item.finalReachable).map(item => item.id) }
writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2))
if (summary.failures || !summary.sourceUnchanged || before.head !== after.head || before.tree !== after.tree || after.status || contextsOpened !== contextsClosed) process.exitCode = 1
