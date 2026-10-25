// 交接截图：对云端当前版本采集 1440px 桌面与 390px 窄屏截图（覆盖四步流程与三个工作区面板）
import { chromium } from 'playwright'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://81.70.40.146:8082'
const OUT = process.argv[3] ?? path.join('..', 'Ripple-ui-handoff', '20261025-v1', 'screens')
const TAG = process.argv[4] ?? 'ui-20261025-v1'

const browser = await chromium.launch()

async function shoot(name, { width, height }, steps) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(`${BASE}/experience.html?adapter=demo`, { waitUntil: 'networkidle', timeout: 45_000 })
  await page.waitForTimeout(1200)
  await steps(page)
  await page.waitForTimeout(700)
  const file = path.join(OUT, `${TAG}-${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  console.log(`${file}  errors=${errors.length}`)
  await page.close()
  return errors
}

const desktop = { width: 1440, height: 900 }
const mobile = { width: 390, height: 844 }

const selectAndType = async page => {
  await page.getByTestId('canvas-el-el:hero-title').click()
  await page.getByTestId('draft-text-input').fill('冬日茶器市集')
  await page.waitForTimeout(300)
}

const all = []
// ---- 桌面 ----
all.push(...await shoot('desktop-01-初始', desktop, async () => {}))
all.push(...await shoot('desktop-02-改内容', desktop, async p => {
  await p.getByTestId('step-tab-2').click()
  await selectAndType(p)
}))
all.push(...await shoot('desktop-03-影响范围', desktop, async p => {
  await p.getByTestId('step-tab-3').click()
  await selectAndType(p)
}))
all.push(...await shoot('desktop-04-检查并生成', desktop, async p => {
  await p.getByTestId('step-tab-4').click()
  await selectAndType(p)
}))
all.push(...await shoot('desktop-05-前后对照', desktop, async p => {
  await selectAndType(p)
  await p.getByTestId('tab-compare').click()
}))
all.push(...await shoot('desktop-06-历史记录', desktop, async p => {
  await selectAndType(p)
  await p.getByTestId('tab-history').click()
}))
all.push(...await shoot('desktop-07-证据与解释', desktop, async p => {
  await selectAndType(p)
  await p.getByTestId('tab-evidence').click()
}))

// ---- 窄屏 ----
all.push(...await shoot('mobile-01-初始', mobile, async () => {}))
all.push(...await shoot('mobile-02-前后对照', mobile, async p => {
  await selectAndType(p)
  await p.getByTestId('tab-compare').click()
}))
all.push(...await shoot('mobile-03-历史记录', mobile, async p => {
  await selectAndType(p)
  await p.getByTestId('tab-history').click()
}))

await browser.close()
console.log(all.length === 0 ? 'ALL_CLEAN' : `ERRORS: ${all.join(' | ')}`)
