import { test, expect } from '@playwright/test'

const savedMaterials = {
  version_id: 'b2d18c61-0714-4e46-b93a-1920fdaaf490', version_number: 5,
  materials: [{ artifact_id: '8ad9cfa1-1c8e-4733-a16f-90cbc0a35111', title: 'Java Explained', position: 15,
    content_markdown: '[Open Java explained: notes and slides](https://ics3u-java-explained.stewchan.chatgpt.site)' }],
}
const frozenContext = {
  content_version_id: 'version-3', content_version_number: 3,
  source_blueprint_version_id: 'version-4', source_blueprint_version_number: 4, source_draft_revision: 4,
  course: { title: 'ICS3U', subject: 'Computer Science', grade_level: '11', outline_markdown: '',
    assignment_titles: ['A4 - Unit 2: Basic Java'], test_titles: ['Unit 1: Karel'] },
  guidance: { course_expectations_markdown: '', assignment_guidance_markdown: '', test_guidance_markdown: '', unit_exceptions: [] },
}

test.use({ storageState: '.auth/teacher.json' })

async function classroomId(request: import('@playwright/test').APIRequestContext) {
  const result = await request.get('/api/teacher/classrooms')
  expect(result.ok()).toBeTruthy()
  const { classrooms } = await result.json()
  const classroom = classrooms.find((item: { class_code: string }) => item.class_code === 'TEST01')
  expect(classroom).toBeTruthy()
  return classroom.id as string
}

for (const viewport of ['desktop', 'mobile'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`latest materials and frozen content: ${viewport} ${theme}`, async ({ page, request }, testInfo) => {
      const id = await classroomId(request)
      await page.setViewportSize(viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 })
      await page.addInitScript((value) => localStorage.setItem('theme', value), theme)
      await page.emulateMedia({ colorScheme: theme })
      await page.route(`**/api/teacher/classrooms/${id}/authoring-guidance`, route => route.fulfill({ json: { context: frozenContext } }))
      await page.route(`**/api/teacher/classrooms/${id}/blueprint-materials`, route => route.fulfill({ json: { materials: savedMaterials } }))
      const writes: string[] = []
      page.on('request', req => { if (req.url().includes('/api/') && !['GET', 'HEAD'].includes(req.method())) writes.push(req.url()) })
      await page.goto(`/classrooms/${id}?tab=blueprint&section=content`)
      const materials = page.getByRole('region', { name: 'Blueprint materials' })
      await expect(materials.getByRole('heading', { name: 'Java Explained' })).toBeVisible()
      await expect(page.getByText('Content Version 3', { exact: false })).toBeVisible()
      await expect(page.getByText('Guidance Version 4', { exact: true })).toBeVisible()
      await expect(materials.getByText('Latest saved Blueprint · Version 5')).toBeVisible()
      const link = materials.getByRole('link', { name: 'Open Java explained: notes and slides' })
      await expect(link).toHaveAttribute('href', 'https://ics3u-java-explained.stewchan.chatgpt.site/')
      await link.focus()
      await expect(link).toBeFocused()
      await materials.scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`${viewport}-${theme}.png`) })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
      expect(writes).toEqual([])
    })
  }
}

test('failed material read retries while frozen content remains visible', async ({ page, request }, testInfo) => {
  const id = await classroomId(request)
  await page.route(`**/api/teacher/classrooms/${id}/authoring-guidance`, route => route.fulfill({ json: { context: frozenContext } }))
  let reads = 0
  await page.route(`**/api/teacher/classrooms/${id}/blueprint-materials`, route => {
    reads += 1
    return reads === 1 ? route.fulfill({ status: 500, json: { error: 'Unavailable' } })
      : route.fulfill({ json: { materials: { ...savedMaterials, materials: [] } } })
  })
  await page.goto(`/classrooms/${id}?tab=blueprint&section=content`)
  const materials = page.getByRole('region', { name: 'Blueprint materials' })
  await expect(materials.getByText('Could not load materials')).toBeVisible()
  await expect(page.getByText('A4 - Unit 2: Basic Java')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('error.png') })
  await materials.getByRole('button', { name: 'Try again' }).click()
  await expect(materials.getByText('No materials in the latest saved Blueprint.')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('empty.png') })
})

test('real API keeps unlinked classrooms empty and rejects students', async ({ request, browser }) => {
  const id = await classroomId(request)
  const result = await request.get(`/api/teacher/classrooms/${id}/blueprint-materials`)
  expect(result.status()).toBe(200)
  expect(await result.json()).toEqual({ materials: null })
  const student = await browser.newContext({ storageState: '.auth/student.json' })
  try {
    const forbidden = await student.request.get(`${test.info().project.use.baseURL}/api/teacher/classrooms/${id}/blueprint-materials`)
    expect(forbidden.status()).toBe(403)
  } finally { await student.close() }
})

test('loading materials does not hide the classroom frozen content', async ({ page, request }, testInfo) => {
  const id = await classroomId(request)
  await page.route(`**/api/teacher/classrooms/${id}/authoring-guidance`, route => route.fulfill({ json: { context: frozenContext } }))
  let finish!: () => void
  const pending = new Promise<void>((resolve) => { finish = resolve })
  await page.route(`**/api/teacher/classrooms/${id}/blueprint-materials`, async route => {
    await pending
    await route.fulfill({ json: { materials: savedMaterials } })
  })
  await page.goto(`/classrooms/${id}?tab=blueprint&section=content`)
  const materials = page.getByRole('region', { name: 'Blueprint materials' })
  await expect(materials.getByText('Loading materials')).toBeVisible()
  await expect(page.getByText('A4 - Unit 2: Basic Java')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('loading.png') })
  finish()
  await expect(materials.getByRole('heading', { name: 'Java Explained' })).toBeVisible()
})

test('Pattern Lab page-state reference', async ({ page }, testInfo) => {
  await page.goto('/pattern-lab#page-states')
  const reference = page.getByTestId('pattern-section-page-states')
  await expect(reference.getByText('Could not load classroom', { exact: true })).toBeVisible()
  await reference.screenshot({ path: testInfo.outputPath('page-state-reference.png') })
})
