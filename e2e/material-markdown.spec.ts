import { test, expect } from '@playwright/test'

test.use({ storageState: '.auth/teacher.json' })
test.setTimeout(90_000)

for (const viewport of ['desktop', 'mobile'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`material Markdown review, save and student reading: ${viewport} ${theme}`, async ({ page, request, browser, baseURL }, info) => {
      // This smoke writes only disposable fixtures to the local/CI database.
      expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL!).hostname)
      const result = await request.get('/api/teacher/classrooms')
      expect(result.ok()).toBeTruthy()
      const { classrooms } = await result.json()
      const classroom = classrooms.find((item: { class_code: string }) => item.class_code === 'TEST01')
      expect(classroom).toBeTruthy()
      const title = `Markdown reading ${viewport} ${theme} ${Date.now()}`
      const endpoint = `/api/teacher/classrooms/${classroom.id}/materials`
      const created = await request.post(endpoint, { data: { title, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original reading' }] }] }, is_draft: true } })
      expect(created.ok()).toBeTruthy()
      const { material } = await created.json()
      const student = await browser.newContext({ storageState: '.auth/student.json', baseURL, viewport: viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 } })
      try {
        await page.setViewportSize(viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 })
        await page.addInitScript(value => localStorage.setItem('theme', value), theme)
        await page.emulateMedia({ colorScheme: theme })
        const studentBefore = await student.request.get(`/api/student/classrooms/${classroom.id}/materials`)
        expect(studentBefore.ok()).toBeTruthy()
        expect((await studentBefore.json()).materials.some((item: { id: string }) => item.id === material.id)).toBe(false)
        await page.goto(`/classrooms/${classroom.id}?tab=assignments`)
        await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Material', exact: true })
        await dialog.getByRole('button', { name: 'Visual', exact: true }).focus()
        await page.keyboard.press('ArrowRight')
        await expect(dialog.getByRole('button', { name: 'Markdown', exact: true })).toBeFocused()
        const source = dialog.getByRole('textbox', { name: 'Material Markdown' })
        await expect(source).toHaveValue('Original reading')
        await source.fill('# Before class\n\nRead **chapter two**.\n\n- Bring notes\n\n[Open guide](https://example.com/guide)\n\n```\nprint("hello")\n```')
        await expect(dialog.getByRole('button', { name: 'Post', exact: true })).toBeDisabled()
        await info.attach('teacher-markdown', { body: await dialog.screenshot({ path: info.outputPath('teacher-markdown.png') }), contentType: 'image/png' })
        const preview = dialog.getByRole('button', { name: 'Preview', exact: true })
        await preview.click()
        const review = page.getByRole('dialog', { name: 'Material preview' })
        await expect(review.getByRole('region', { name: 'Current material content' })).toContainText('Original reading')
        await expect(review.getByRole('region', { name: 'Proposed material content' })).toContainText('chapter two')
        await info.attach('teacher-review', { body: await review.screenshot({ path: info.outputPath('teacher-review.png') }), contentType: 'image/png' })
        await page.keyboard.press('Escape')
        await expect(preview).toBeFocused()
        await dialog.getByRole('button', { name: 'Apply Markdown' }).click()
        await expect(dialog.getByRole('button', { name: 'Post', exact: true })).toBeEnabled()
        const save = page.waitForResponse(response => response.url().endsWith(`${endpoint}/${material.id}`) && response.request().method() === 'PATCH')
        await dialog.getByRole('button', { name: 'Post', exact: true }).click()
        expect((await save).ok()).toBeTruthy()
        await expect(dialog).toBeHidden()
        const studentPage = await student.newPage()
        await studentPage.addInitScript(value => localStorage.setItem('theme', value), theme)
        await studentPage.emulateMedia({ colorScheme: theme })
        await studentPage.goto(`/classrooms/${classroom.id}?tab=assignments`)
        await studentPage.getByTestId('material-card').filter({ hasText: title }).click()
        await expect(studentPage.getByRole('heading', { name: 'Before class' })).toBeVisible()
        await expect(studentPage.getByRole('link', { name: 'Open guide' })).toHaveAttribute('href', 'https://example.com/guide')
        await expect(studentPage.getByText('Bring notes', { exact: true })).toBeVisible()
        expect(await studentPage.locator('strong').filter({ hasText: 'chapter two' }).count()).toBe(1)
        await expect(studentPage.getByRole('button', { name: 'Apply Markdown' })).toHaveCount(0)
        await info.attach('student-reading', { body: await studentPage.screenshot({ path: info.outputPath('student-reading.png') }), contentType: 'image/png' })
        for (const rendered of [page, studentPage]) expect(await rendered.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
      } finally {
        await student.close()
        expect((await request.delete(`${endpoint}/${material.id}`)).ok()).toBeTruthy()
      }
    })
  }
}
