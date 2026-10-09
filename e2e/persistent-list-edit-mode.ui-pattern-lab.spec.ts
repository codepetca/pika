import { expect, test } from '@playwright/test'
import { mockTableShellReads, TABLE_CLASSROOM_ID } from './helpers/teacher-student-tables'

test.setTimeout(90_000)

const timestamp = '2026-01-01T12:00:00Z'

for (const surface of ['classwork', 'tests'] as const) {
  test(`${surface} keeps list edit mode through deletes and editor close`, async ({ page }, info) => {
    await page.addInitScript(theme => localStorage.setItem('theme', theme), info.project.metadata.theme as string)
    await mockTableShellReads(page)
    const rows = [1, 2, 3].map(index => ({
      id: `30000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`,
      classroom_id: TABLE_CLASSROOM_ID,
      title: `Practice ${index}`, position: index,
      description: '', instructions_markdown: '', rich_instructions: null, due_at: null,
      is_draft: true, status: 'draft', show_results: false,
      created_at: timestamp, updated_at: timestamp,
      stats: { total_students: 0, responded: 0, submitted: 0, late: 0, questions_count: 0 },
    }))
    const deleted: string[] = []
    const reorderRequests: string[] = []
    page.on('request', request => {
      if (request.method() !== 'GET' && new URL(request.url()).pathname.endsWith('/reorder')) {
        reorderRequests.push(request.url())
      }
    })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const api = surface === 'classwork' ? '/api/teacher/assignments' : '/api/teacher/tests'
    await page.route(`**${api}**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (request.method() === 'DELETE') {
        const id = path.split('/').at(-1)!
        deleted.push(id)
        rows.splice(rows.findIndex(row => row.id === id), 1)
        return route.fulfill({ json: { success: true } })
      }
      if (request.method() !== 'GET') return route.abort()
      if (path === api) return route.fulfill({ json: surface === 'classwork' ? { assignments: rows } : { tests: rows } })
      const row = rows.find(row => path.includes(row.id))
      return route.fulfill({ json: surface === 'classwork' ? { assignment: row, students: [] } : { test: row, questions: [], has_draft: false } })
    })
    const modeName = surface === 'classwork' ? 'Edit classwork' : 'Edit Tests'
    const deleteButton = (title: string) => page.getByRole('button', { name: `Delete ${title}`, exact: true })
    await page.goto(`/e2e-fixtures/teacher-student-tables?tab=${surface === 'classwork' ? 'assignments' : 'tests'}`)
    await expect(page.getByRole('button', { name: 'Practice 1', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'More actions', exact: true }).click()
    await page.getByRole('menuitemcheckbox', { name: modeName }).click()
    await expect(deleteButton('Practice 1')).toBeVisible()

    if (surface === 'classwork') {
      await page.getByRole('button', { name: 'Edit Practice 1', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(deleteButton('Practice 1')).toBeVisible()
    }

    // Escape dismisses the menu/confirmation first and preserves list editing.
    await page.getByRole('button', { name: 'More actions', exact: true }).click()
    await page.getByRole('menuitemcheckbox', { name: modeName }).focus()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(deleteButton('Practice 1')).toBeVisible()
    await deleteButton('Practice 1').click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(deleteButton('Practice 1')).toBeVisible()

    for (const title of ['Practice 1', 'Practice 2']) {
      await deleteButton(title).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(deleteButton(title)).toHaveCount(0)
    }
    expect(deleted).toHaveLength(2)
    await expect(deleteButton('Practice 3')).toBeVisible()
    await page.screenshot({ path: info.outputPath(`${surface}-edit-after-deletes.png`), animations: 'disabled' })
    await page.getByRole('button', { name: 'More actions', exact: true }).click()
    await expect(page.getByRole('menuitemcheckbox', { name: modeName })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('menuitemcheckbox', { name: modeName }).press('Escape')
    const handle = surface === 'classwork'
      ? page.getByRole('button', { name: 'Drag to reorder', exact: true }).first()
      : page.getByRole('button', { name: 'Drag to reorder Practice 3', exact: true })
    const orderBeforeDrag = await page.getByRole('button', { name: /^(Edit )?Practice [123]$/ }).allTextContents()
    const box = (await handle.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 20, { steps: 5 })
    await expect(handle).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(handle).not.toHaveAttribute('aria-pressed', 'true')
    await expect(deleteButton('Practice 3')).toBeVisible()
    expect(reorderRequests).toEqual([])
    expect(await page.getByRole('button', { name: /^(Edit )?Practice [123]$/ }).allTextContents()).toEqual(orderBeforeDrag)
    await page.keyboard.press('Escape')
    await expect(deleteButton('Practice 3')).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`${surface}-regular-after-escape.png`), animations: 'disabled' })
    expect(errors).toEqual([])
  })
}
