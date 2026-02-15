import type { Frame, Page } from 'playwright'
import { FRAMES, TABS } from './ta-selectors'

/**
 * Select a course in the TeachAssist sidebar by matching a search string
 * against the link text (e.g. "GLD2OOH").
 *
 * This clicks the link in menuFrame and waits for mainFrame to reload.
 */
export async function selectCourse(page: Page, courseSearchText: string): Promise<void> {
  const menuFrame = page.frame(FRAMES.menu)
  if (!menuFrame) {
    throw new Error('Menu frame not found. Are you on the TeachAssist dashboard?')
  }

  // Find the course link whose text contains the search string
  const links = await menuFrame.$$('a')
  let courseLink = null

  for (const link of links) {
    const text = await link.textContent()
    if (text && text.includes(courseSearchText)) {
      courseLink = link
      break
    }
  }

  if (!courseLink) {
    throw new Error(
      `Course containing "${courseSearchText}" not found in the sidebar. ` +
      `Available courses may not match the configured search text.`
    )
  }

  // Click the course link — this causes mainFrame to navigate
  await courseLink.click()

  // Wait for the main frame to fully reload with course content.
  // After clicking a course, TA loads the Students tab which contains
  // navigation links like "Attendance", "Assessment", etc.
  // We need to wait for the frame to navigate and then for the tab links to appear.
  await page.waitForTimeout(2000)

  const mainFrame = page.frame(FRAMES.main)
  if (!mainFrame) {
    throw new Error('Main frame not found after course selection.')
  }

  // Wait for the Attendance tab link to appear (proves the course page loaded)
  await mainFrame.waitForSelector(`a:has-text("${TABS.attendance}")`, { timeout: 10_000 }).catch(() => {
    throw new Error('Course selected but the tab bar did not load in the main frame.')
  })
}

/**
 * Navigate to the Attendance tab within the currently selected course.
 * Clicks the "Attendance" link/tab in the main frame.
 */
export async function navigateToAttendance(page: Page): Promise<Frame> {
  const mainFrame = page.frame(FRAMES.main)
  if (!mainFrame) {
    throw new Error('Main frame not found. Select a course first.')
  }

  // Wait for the Attendance tab link to be present, then click it.
  // TA uses <a> tags with text "Attendance" inside a tab bar.
  const attendanceLink = await mainFrame.waitForSelector(
    `a:has-text("${TABS.attendance}")`,
    { timeout: 10_000 }
  ).catch(() => {
    throw new Error('Attendance tab not found. Is a course selected?')
  })

  await attendanceLink.click()

  // Wait for the attendance form to load (look for the date input)
  await mainFrame.waitForSelector('input[name="inputDate"]', { timeout: 10_000 }).catch(() => {
    throw new Error('Attendance page did not load. The date input field was not found.')
  })

  return mainFrame
}
