import { chromium } from '@playwright/test'

async function installCursorOverlay(page: any) {
  await page.addInitScript(() => {
    const mountCursorOverlay = () => {
      if (document.getElementById('marketing-cursor')) return
      if (!document.body) return
      const cursor = document.createElement('div')
      cursor.id = 'marketing-cursor'
      cursor.style.position = 'fixed'
      cursor.style.width = '40px'
      cursor.style.height = '40px'
      cursor.style.borderRadius = '9999px'
      cursor.style.border = '4px solid red'
      cursor.style.background = 'yellow'
      cursor.style.zIndex = '2147483647'
      cursor.style.left = '240px'
      cursor.style.top = '160px'
      document.body.appendChild(cursor)
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountCursorOverlay, { once: true })
    } else {
      mountCursorOverlay()
    }
  })
}

async function run() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await installCursorOverlay(page)
  await page.goto('http://localhost:3017/classrooms', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const exists = await page.evaluate(() => !!document.getElementById('marketing-cursor'))
  console.log('cursor_exists=', exists)
  await page.screenshot({ path: '/tmp/check-cursor.png' })
  await browser.close()
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
