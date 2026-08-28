import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const baseUrl = process.env.UI_BASE_URL || 'http://127.0.0.1:5173'
const cdpUrl = process.env.CHROME_CDP_URL || 'http://127.0.0.1:9231'
const outputRoot = new URL('../../anti-slop/screenshots/', import.meta.url).pathname
const reportPath = new URL('../../anti-slop/ui-audit.json', import.meta.url).pathname

const apiTasks = await fetch(`${baseUrl}/api/v1/tasks`).then(response => response.ok ? response.json() : null).catch(() => null) as { tasks?: Array<{ id: string }> } | null
const firstTaskId = apiTasks?.tasks?.[0]?.id
const routes = [
  ['home', '/'],
  ['problems', '/problems'],
  ['dashboard', '/dashboard'],
  ['tasks', '/tasks'],
  ['builders', '/agents'],
  ['post-task', '/post'],
  ['docs', '/docs'],
  ['disputes', '/disputes'],
  ['profile', '/profile'],
  ...(firstTaskId ? [
    ['task-details', `/details?taskId=${encodeURIComponent(firstTaskId)}`],
    ['task-bids', `/bid?taskId=${encodeURIComponent(firstTaskId)}`],
  ] : []),
] as const

const viewports = [
  { name: 'mobile-320', width: 320, height: 720 },
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1024', width: 1024, height: 900 },
  { name: 'desktop-1440', width: 1440, height: 1000 },
] as const

const browser = await chromium.connectOverCDP(cdpUrl)
const context = browser.contexts()[0]
if (!context) throw new Error('Chrome CDP has no browser context')
const page = await context.newPage()
const runtimeErrors: string[] = []
page.on('pageerror', error => runtimeErrors.push(error.message))
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('favicon')) runtimeErrors.push(message.text())
})

type Finding = { viewport: string; route: string; kind: string; detail: string }
const findings: Finding[] = []

for (const viewport of viewports) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  const screenshotDir = `${outputRoot}${viewport.name}`
  await mkdir(screenshotDir, { recursive: true })

  for (const [name, route] of routes) {
    runtimeErrors.length = 0
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' })
    await page.locator('main').waitFor({ state: 'visible' })
    await page.locator('main h1').waitFor({ state: 'visible', timeout: 8_000 })
    await page.waitForTimeout(150)

    const result = await page.evaluate(() => {
      const visible = (element: Element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth
      }
      const candidates = [...document.querySelectorAll('button, a[href], input, select, textarea, summary')].filter(visible)
      const smallTargets = candidates.flatMap(element => {
        const control = element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)
          ? element.closest('label') || element
          : element
        const rect = control.getBoundingClientRect()
        if (rect.width >= 44 && rect.height >= 44) return []
        const name = element.getAttribute('aria-label') || element.textContent?.trim() || element.getAttribute('name') || element.tagName
        return [`${element.tagName.toLowerCase()} "${name.slice(0, 60)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`]
      })
      const unnamed = candidates.flatMap(element => {
        const name = element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent?.trim()
        const labelledControl = (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) && Boolean(element.labels?.length)
        if (name || labelledControl) return []
        return [element.outerHTML.slice(0, 120)]
      })
      const root = document.documentElement
      return {
        horizontalOverflow: Math.max(root.scrollWidth, document.body.scrollWidth) - window.innerWidth,
        h1Count: document.querySelectorAll('main h1').length,
        mainCount: document.querySelectorAll('main').length,
        smallTargets,
        unnamed,
      }
    })

    if (result.horizontalOverflow > 1) findings.push({ viewport: viewport.name, route, kind: 'horizontal-overflow', detail: `${result.horizontalOverflow}px` })
    if (result.h1Count !== 1) findings.push({ viewport: viewport.name, route, kind: 'heading', detail: `${result.h1Count} h1 elements` })
    if (result.mainCount !== 1) findings.push({ viewport: viewport.name, route, kind: 'landmark', detail: `${result.mainCount} main elements` })
    for (const detail of result.smallTargets) findings.push({ viewport: viewport.name, route, kind: 'touch-target', detail })
    for (const detail of result.unnamed) findings.push({ viewport: viewport.name, route, kind: 'accessible-name', detail })
    for (const detail of [...new Set(runtimeErrors)]) findings.push({ viewport: viewport.name, route, kind: 'runtime-error', detail })

    await page.screenshot({ path: `${screenshotDir}/${name}.png`, fullPage: true })
  }
}

await page.close()
await browser.close()

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  routes: routes.map(([, route]) => route),
  viewports,
  findingCount: findings.length,
  findings,
}
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
if (findings.length) process.exitCode = 1
