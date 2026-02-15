import type { Frame } from 'playwright'
import { ATTENDANCE } from './ta-selectors'
import type { TAStudentRow, TAAttendancePageState, TAAttendanceEntry, TAExecutionMode } from '../types'

/**
 * Read the current state of the TA attendance page:
 * current date, block, and list of students with their radio button name patterns.
 */
export async function readAttendancePage(mainFrame: Frame): Promise<TAAttendancePageState> {
  // Read the current date from the input field
  const date = await mainFrame.$eval(
    ATTENDANCE.dateInput,
    (el) => (el as HTMLInputElement).value
  )

  // Read the current block from the select
  const block = await mainFrame.$eval(
    ATTENDANCE.blockSelect,
    (el) => (el as HTMLSelectElement).value
  )

  // Extract student names and their radio button name patterns
  // Each student row has 4 radio buttons (P, L, A, E) sharing the same name
  // The name follows pattern: rNNN_attendance_NNN
  const students: TAStudentRow[] = await mainFrame.$$eval('tr', (rows) => {
    const result: Array<{ name: string; radioName: string }> = []

    for (const row of rows) {
      const radios = row.querySelectorAll('input[type="radio"]')
      if (radios.length < 4) continue // not a student row

      // First cell contains the student name (may be an <a> or plain text)
      const firstCell = row.querySelector('td')
      if (!firstCell) continue

      const anchor = firstCell.querySelector('a')
      const name = (anchor ? anchor.textContent : firstCell.textContent)?.trim() || ''

      // Skip header rows like "For All Students" or "First name"
      if (!name || name === 'For All Students' || name === 'First name') continue

      const radioName = (radios[0] as HTMLInputElement).name
      result.push({ name, radioName })
    }

    return result
  })

  return { date, block, students }
}

/**
 * Set the date on the attendance page and wait for the form to reload.
 *
 * TeachAssist reloads the page when the date changes, so we need to
 * clear the field, type the new date, and trigger navigation.
 */
export async function setDate(mainFrame: Frame, date: string): Promise<void> {
  const currentDate = await mainFrame.$eval(
    ATTENDANCE.dateInput,
    (el) => (el as HTMLInputElement).value
  )

  // If already on the right date, no navigation needed
  if (currentDate === date) return

  // Set the date value and submit the form via JavaScript.
  // TA's attendance page is a PHP form — changing the date input value
  // and submitting the form causes the page to reload with the new date's data.
  // Pressing Enter or using Playwright's fill() alone won't trigger navigation.
  await mainFrame.evaluate((newDate) => {
    const input = document.querySelector('input[name="inputDate"]') as HTMLInputElement
    if (input) {
      input.value = newDate
      // Submit the form the input belongs to
      const form = input.closest('form')
      if (form) {
        form.submit()
      }
    }
  }, date)

  // Wait for the page to reload — the frame navigates, so wait for the date input
  // to reappear in the new page
  await mainFrame.waitForSelector(ATTENDANCE.dateInput, {
    timeout: 15_000,
    state: 'attached',
  }).catch(() => {
    throw new Error(
      `Timed out waiting for attendance page to reload after setting date to ${date}.`
    )
  })

  // Small delay for the page to fully settle after navigation
  await mainFrame.page().waitForTimeout(500)

  // Verify the date was set correctly
  const newDate = await mainFrame.$eval(
    ATTENDANCE.dateInput,
    (el) => (el as HTMLInputElement).value
  )

  if (newDate !== date) {
    throw new Error(
      `Failed to set date to ${date}. Page shows ${newDate}. ` +
      `The date may not be a valid class day in TeachAssist.`
    )
  }
}

/**
 * Fill attendance radio buttons for matched students.
 * Each entry specifies which radio to select (by name + status value).
 */
export async function fillAttendance(
  mainFrame: Frame,
  entries: TAAttendanceEntry[]
): Promise<void> {
  for (const entry of entries) {
    const selector = ATTENDANCE.radio(entry.radioName, entry.status)
    const radio = await mainFrame.$(selector)
    if (!radio) {
      throw new Error(
        `Radio button not found: name="${entry.radioName}" value="${entry.status}". ` +
        `The student may not be on this date's attendance page.`
      )
    }
    await radio.check()
  }
}

/**
 * Click the "Record Attendance" button to submit the form.
 * Waits for the page to process the submission.
 */
export async function submitAttendance(mainFrame: Frame): Promise<void> {
  const recordButton = await mainFrame.$(ATTENDANCE.recordButton)
  if (!recordButton) {
    throw new Error('Record Attendance button not found on the page.')
  }

  // The button's onclick handler submits the form.
  await recordButton.click()

  // Wait for the page to reload/process after submission.
  // After recording, TA typically reloads the attendance page.
  await mainFrame.waitForSelector(ATTENDANCE.dateInput, { timeout: 15_000 }).catch(() => {
    throw new Error(
      'Attendance form did not reload after submission. ' +
      'The submission may have failed or timed out.'
    )
  })
}

/**
 * In confirmation mode, the form has been filled out but the teacher
 * needs to review and click "Record Attendance" themselves in the visible
 * browser window.
 *
 * We poll until we detect that the page has been submitted (the date input
 * reappears after a form post, or the page navigates). Times out after 5
 * minutes — the teacher has plenty of time to review.
 */
export async function waitForManualSubmit(mainFrame: Frame, currentDate: string): Promise<void> {
  const MANUAL_TIMEOUT = 5 * 60 * 1000 // 5 minutes
  const POLL_INTERVAL = 1_000

  const start = Date.now()

  // The "Record Attendance" button disappears or the page reloads after
  // submission. We detect this by watching for the button to become stale
  // or the page to reload (the date input re-renders with a new DOM node).
  const originalButton = await mainFrame.$(ATTENDANCE.recordButton)

  while (Date.now() - start < MANUAL_TIMEOUT) {
    await mainFrame.page().waitForTimeout(POLL_INTERVAL)

    try {
      // Check if the original button is still attached to the DOM.
      // If the form was submitted the page reloads and the element becomes detached.
      const stillAttached = originalButton ? await originalButton.isVisible().catch(() => false) : false

      if (!stillAttached) {
        // Page reloaded — submission happened. Wait for the new form to load.
        await mainFrame.waitForSelector(ATTENDANCE.dateInput, { timeout: 10_000 })
        return
      }
    } catch {
      // Element detached or frame navigated — submission happened
      await mainFrame.waitForSelector(ATTENDANCE.dateInput, { timeout: 10_000 }).catch(() => {})
      return
    }
  }

  throw new Error(
    `Timed out waiting for manual submission on date ${currentDate}. ` +
    `The teacher did not click "Record Attendance" within 5 minutes.`
  )
}

/**
 * Convenience: fill and optionally submit attendance for a single date.
 *
 * - `full_auto`: fills the form and clicks submit automatically.
 * - `confirmation`: fills the form, then waits for the teacher to manually
 *   click "Record Attendance" in the visible browser window.
 */
export async function recordAttendanceForDate(
  mainFrame: Frame,
  date: string,
  entries: TAAttendanceEntry[],
  executionMode: TAExecutionMode = 'full_auto'
): Promise<void> {
  await setDate(mainFrame, date)
  await fillAttendance(mainFrame, entries)

  if (executionMode === 'full_auto') {
    await submitAttendance(mainFrame)
  } else {
    // confirmation mode — wait for the teacher to review and submit
    await waitForManualSubmit(mainFrame, date)
  }
}
