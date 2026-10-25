import { chromium } from 'playwright'

const url = 'http://127.0.0.1:4173/experience.html?adapter=demo'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
// give React a moment to mount the workbench
await page.waitForTimeout(1500)

const bodyText = await page.evaluate(() => document.body.innerText)
const labels = ['选择元素', '修改内容', '影响范围', '检查并生成']
const found = labels.filter((l) => bodyText.includes(l))

// also try to detect the step container / progress
const stepCount = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('[data-testid]'))
  return els.map((e) => e.getAttribute('data-testid'))
})

await page.screenshot({ path: 'scripts/smoke-four-step.png', fullPage: false })
await browser.close()

console.log('URL:', url)
console.log('found step labels:', JSON.stringify(found))
console.log('total data-testid elements:', stepCount.length)
console.log('sample testids:', JSON.stringify(stepCount.slice(0, 30)))
console.log('console/page errors:', errors.length ? JSON.stringify(errors.slice(0, 10)) : 'none')
process.exit(found.length >= 1 ? 0 : 2)
