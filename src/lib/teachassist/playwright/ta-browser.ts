import { chromium } from 'playwright'
import type { Browser, Page, Frame } from 'playwright'
import { FRAMES } from './ta-selectors'
import type { BrowserOptions, TASession } from './types'

const DEFAULT_OPTIONS: BrowserOptions = {
  headless: true,
  timeout: 30_000,
}

/**
 * Launch a headless Chromium browser.
 */
export async function launchBrowser(options: Partial<BrowserOptions> = {}): Promise<Browser> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  return chromium.launch({ headless: opts.headless })
}

/**
 * Create a new page in the browser with default settings.
 */
export async function createPage(browser: Browser, timeout = DEFAULT_OPTIONS.timeout): Promise<Page> {
  const page = await browser.newPage()
  page.setDefaultTimeout(timeout)
  page.setDefaultNavigationTimeout(timeout)
  return page
}

/**
 * Retrieve the main content frame from the TeachAssist frameset page.
 * Waits for the frame to be available.
 */
export async function getMainFrame(page: Page): Promise<Frame> {
  const frame = page.frame(FRAMES.main)
  if (!frame) {
    throw new Error(`Frame "${FRAMES.main}" not found. Is this the TeachAssist frameset page?`)
  }
  return frame
}

/**
 * Retrieve the menu/sidebar frame from the TeachAssist frameset page.
 */
export async function getMenuFrame(page: Page): Promise<Frame> {
  const frame = page.frame(FRAMES.menu)
  if (!frame) {
    throw new Error(`Frame "${FRAMES.menu}" not found. Is this the TeachAssist frameset page?`)
  }
  return frame
}

/**
 * Close the browser and release all resources.
 */
export async function closeBrowser(browser: Browser): Promise<void> {
  await browser.close()
}

/**
 * Convenience: launch browser, create page, resolve both frames.
 * Returns a full TASession ready for automation.
 * Caller must call closeBrowser() when done.
 */
export async function createSession(options: Partial<BrowserOptions> = {}): Promise<TASession> {
  const browser = await launchBrowser(options)
  const page = await createPage(browser, options.timeout)
  // Frames only exist after navigating to the frameset page,
  // so we return a deferred session that resolves frames later.
  // The auth module will call resolveFrames() after login.
  return { browser, page } as unknown as TASession
}

/**
 * After the frameset page has loaded (post-login), resolve both frames
 * and attach them to the session.
 */
export async function resolveFrames(session: Pick<TASession, 'page'>): Promise<{ mainFrame: Frame; menuFrame: Frame }> {
  // Wait a beat for frames to settle
  await session.page.waitForTimeout(1000)

  const mainFrame = await getMainFrame(session.page)
  const menuFrame = await getMenuFrame(session.page)
  return { mainFrame, menuFrame }
}
