import { expect, test } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { assertAppliedPreviewInteractable, assertDesktopPreviewViewport, clickDesktopNavTarget, mountAppliedPreviewFrame, unmountAppliedPreviewFrame } from './applied-preview-navigation'

const footerMarker = '山野器物 · Ripple UI验收'
const navLabels = ['秋日手作节', '商品专题', '品牌故事'] as const

/** Replicates the real Bolt conflict structure: desktop nav inside <nav>, a mobile
 * menu outside <nav>, same-name footer buttons and a same-name body CTA. */
function fixtureHtml(options: { omitNavLabel?: string; inertNavLabel?: string } = {}): string {
  const navButtons = navLabels.filter(label => label !== options.omitNavLabel)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  body { margin: 0; font-family: sans-serif; }
  .menu-toggle, .mobile-menu { display: none; }
  @media (max-width: 767px) {
    header nav { display: none; }
    .menu-toggle { display: block; }
    .mobile-menu:not([hidden]) { display: block; }
  }
</style>
</head>
<body>
<header>
  <nav aria-label="主导航">
    ${navButtons.map(label => label === options.inertNavLabel ? `<button>${label}</button>` : `<button data-nav="${label}">${label}</button>`).join('\n    ')}
  </nav>
  <button class="menu-toggle" aria-label="菜单" aria-expanded="false">菜单</button>
</header>
<div class="mobile-menu" hidden>
  ${navLabels.map(label => `<button data-nav="${label}">${label}</button>`).join('\n  ')}
</div>
<main data-page="home">
  <h1>山野器物首页</h1>
  <button data-nav="品牌故事">品牌故事</button>
</main>
<footer>
  <span class="footer-marker">${footerMarker}</span>
  ${navLabels.map(label => `<button data-nav="${label}">${label}</button>`).join('\n  ')}
</footer>
<script>
  document.querySelector('.menu-toggle').addEventListener('click', () => {
    const menu = document.querySelector('.mobile-menu')
    const open = menu.hasAttribute('hidden')
    if (open) menu.removeAttribute('hidden')
    else menu.setAttribute('hidden', '')
    document.querySelector('.menu-toggle').setAttribute('aria-expanded', String(open))
  })
  for (const button of document.querySelectorAll('[data-nav]')) {
    button.addEventListener('click', () => {
      const label = button.dataset.nav
      const main = document.querySelector('main')
      main.dataset.page = label
      main.querySelector('h1').textContent = label + '页面'
    })
  }
</script>
</body>
</html>`
}

test.describe('applied preview desktop navigation (real Chromium, 1280x800)', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('clicks the unique visible landmark-scoped target for every page and proves page identity', async ({ page }) => {
    await page.setContent(fixtureHtml())
    const viewport = await assertDesktopPreviewViewport(page)
    expect(viewport.width).toBeGreaterThanOrEqual(1200)

    for (const label of navLabels) {
      await clickDesktopNavTarget(page, label)
      await expect(page.locator('main'), `page identity must switch to ${label}`).toHaveAttribute('data-page', label)
      await expect(page.locator('main').getByRole('heading', { level: 1 }), `heading must prove the ${label} page`).toHaveText(`${label}页面`)
      await expect(page.locator('footer').getByText(footerMarker, { exact: true })).toBeVisible()
    }
  })

  test('rejects duplicated visible nav targets instead of clicking an arbitrary one', async ({ page }) => {
    await page.setContent(fixtureHtml())
    await page.evaluate(() => {
      const first = document.querySelector('nav button')!
      first.parentElement!.appendChild(first.cloneNode(true))
    })
    await expect(clickDesktopNavTarget(page, '秋日手作节')).rejects.toThrow(/exactly one visible/)
    await expect(page.locator('main')).toHaveAttribute('data-page', 'home')
  })

  test('catches a nav click that never changes the page instead of trusting the shared footer', async ({ page }) => {
    await page.setContent(fixtureHtml({ inertNavLabel: '秋日手作节' }))
    await clickDesktopNavTarget(page, '秋日手作节')
    // The shared footer marker stays visible the whole time, so only the page-identity
    // assertion can prove the click failed to navigate.
    await expect(page.locator('footer').getByText(footerMarker, { exact: true })).toBeVisible()
    await expect((async () => {
      await expect(page.locator('main'), 'page identity must switch to 秋日手作节').toHaveAttribute('data-page', '秋日手作节')
      await expect(page.locator('main').getByRole('heading', { level: 1 }), 'unique H1 must prove the 秋日手作节 page').toHaveText('秋日手作节页面')
    })()).rejects.toThrow(/秋日手作节/)
    await expect(page.locator('main')).toHaveAttribute('data-page', 'home')
  })

  test('rejects same-name buttons outside the navigation landmark even when they are visible', async ({ page }) => {
    await page.setContent(fixtureHtml({ omitNavLabel: '品牌故事' }))
    await expect(page.getByRole('navigation').getByRole('button', { name: '品牌故事', exact: true })).toHaveCount(0)
    // A body CTA and a footer button remain visible outside the landmark; neither may be accepted.
    await expect(page.getByRole('button', { name: '品牌故事', exact: true })).toHaveCount(2)
    await expect(clickDesktopNavTarget(page, '品牌故事')).rejects.toThrow(/exactly one visible/)
    await expect(page.locator('main')).toHaveAttribute('data-page', 'home')
  })
})

test.describe('applied preview mobile layout (real Chromium, 390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('keeps hidden desktop nav buttons unclickable and fails fast with diagnostics', async ({ page }) => {
    await page.setContent(fixtureHtml())
    // The layout really is mobile: the desktop nav leaves the accessibility tree.
    await expect(page.getByRole('navigation')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '菜单', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '菜单', exact: true }).click()
    await expect(page.locator('.mobile-menu').getByRole('button', { name: '秋日手作节', exact: true })).toBeVisible()

    await expect(clickDesktopNavTarget(page, '秋日手作节')).rejects.toThrow(/exactly one visible/)
    await expect(page.locator('main')).toHaveAttribute('data-page', 'home')
  })
})

// --- Run #17 regression: the applied preview iframe must stay fully visible in the
// outer viewport, otherwise the fixed header inside the nested iframe never becomes
// actionable ("waiting for element to be visible, enabled and stable" forever). ---

function boltLikeInner(options: { occludeNav?: boolean; unstableNav?: boolean } = {}): string {
  const navButtonStyle = options.unstableNav ? ' style="animation: ripple-wobble 0.8s ease-in-out infinite"' : ''
  const overlay = options.occludeNav ? '<div style="position: fixed; top: 0; left: 0; right: 0; height: 64px; z-index: 100; background: rgba(255,0,0,.25);">overlay</div>' : ''
  const keyframes = options.unstableNav ? '<style>@keyframes ripple-wobble { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(6px); } }</style>' : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />${keyframes}<style>
  body { margin: 0; font-family: sans-serif; }
  header { position: fixed; top: 0; left: 0; right: 0; z-index: 50; background: #123; color: #fff; }
  nav { display: flex; gap: 24px; padding: 12px 24px; }
  main div { height: 200px; border-bottom: 1px solid #ccc; }
  footer { padding: 40px; background: #eee; }
</style></head><body>
<header><nav aria-label="主导航">
  <button data-nav="home">首页</button>
  <button data-nav="秋日手作节"${navButtonStyle}>秋日手作节</button>
  <button data-nav="商品专题"${navButtonStyle}>商品专题</button>
  <button data-nav="品牌故事"${navButtonStyle}>品牌故事</button>
</nav></header>
${overlay}
<main data-page="home"><h1>山野器物首页</h1>${Array.from({ length: 30 }, (_, i) => `<div>section ${i}</div>`).join('')}</main>
<footer><span class="footer-marker">${footerMarker}</span>
  ${navLabels.map(label => `<button data-nav="${label}">${label}</button>`).join('\n  ')}
</footer>
<script>
  for (const button of document.querySelectorAll('[data-nav]')) {
    button.addEventListener('click', () => {
      const label = button.dataset.nav
      const main = document.querySelector('main')
      main.dataset.page = label
      main.querySelector('h1').textContent = label + '页面'
    })
  }
</script>
</body></html>`
}

test.describe('applied preview iframe mount (Run #17: real Chromium, outer 1440x1000)', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })
  let server: Server
  let origin = ''

  test.beforeAll(async () => {
    server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      const html = path === '/occluded' ? boltLikeInner({ occludeNav: true }) : path === '/unstable' ? boltLikeInner({ unstableNav: true }) : boltLikeInner()
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(html)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  test.afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())) })

  const longWorkbenchPage = `<!doctype html><html><body>
    ${Array.from({ length: 12 }, (_, i) => `<div style="height:400px;border-bottom:1px solid #444">workbench block ${i}</div>`).join('')}
    <button data-testid="under-host">rollback-standin</button>
  </body></html>`

  test('clicks the fixed-header nav target in an iframe mounted at the end of a long page', async ({ page }) => {
    await page.setContent(longWorkbenchPage)
    await mountAppliedPreviewFrame(page, `${origin}/`)
    await assertAppliedPreviewInteractable(page)
    const frame = page.frameLocator('#applied-bolt-preview')
    const viewport = await assertDesktopPreviewViewport(frame)
    expect(viewport).toEqual({ width: 1280, height: 800 })
    await expect(frame.getByText(footerMarker, { exact: true })).toBeVisible({ timeout: 15_000 })
    for (const label of navLabels) {
      await clickDesktopNavTarget(frame, label)
      await expect(frame.locator('main'), `page identity must switch to ${label}`).toHaveAttribute('data-page', label)
      await expect(frame.locator('main').getByRole('heading', { level: 1 })).toHaveText(`${label}页面`)
      await expect(frame.locator('footer').getByText(footerMarker, { exact: true })).toBeVisible()
    }
  })

  test('stays actionable when the outer page was already scrolled down before mounting', async ({ page }) => {
    await page.setContent(longWorkbenchPage)
    await page.evaluate(() => window.scrollTo(0, 4800))
    await mountAppliedPreviewFrame(page, `${origin}/`)
    await assertAppliedPreviewInteractable(page)
    const frame = page.frameLocator('#applied-bolt-preview')
    await frame.getByText(footerMarker, { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
    await clickDesktopNavTarget(frame, '秋日手作节')
    await expect(frame.locator('main')).toHaveAttribute('data-page', '秋日手作节')
    // The host is position:fixed: no matter where the outer document was scrolled,
    // the iframe stays fully visible and actionable.
    await assertAppliedPreviewInteractable(page)
  })

  test('rejects an occluded nav target instead of clicking through the overlay', async ({ page }) => {
    await page.setContent(longWorkbenchPage)
    await mountAppliedPreviewFrame(page, `${origin}/occluded`)
    await assertAppliedPreviewInteractable(page)
    const frame = page.frameLocator('#applied-bolt-preview')
    await frame.getByText(footerMarker, { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
    await expect(clickDesktopNavTarget(frame, '秋日手作节'), 'an overlay covering the nav must block the click').rejects.toThrow(/秋日手作节/)
    await expect(frame.locator('main')).toHaveAttribute('data-page', 'home')
  })

  test('rejects a continuously moving nav target instead of waiting out the whole budget', async ({ page }) => {
    await page.setContent(longWorkbenchPage)
    await mountAppliedPreviewFrame(page, `${origin}/unstable`)
    await assertAppliedPreviewInteractable(page)
    const frame = page.frameLocator('#applied-bolt-preview')
    await frame.getByText(footerMarker, { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
    await expect(clickDesktopNavTarget(frame, '秋日手作节'), 'an infinitely animating button must never be clicked').rejects.toThrow(/秋日手作节/)
    await expect(frame.locator('main')).toHaveAttribute('data-page', 'home')
  })

  test('unmounting the preview host restores access to the underlying workbench controls', async ({ page }) => {
    await page.setContent(longWorkbenchPage)
    await mountAppliedPreviewFrame(page, `${origin}/`)
    const frame = page.frameLocator('#applied-bolt-preview')
    await frame.getByText(footerMarker, { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
    // While mounted, the host covers the top-left workbench area where rollback-style
    // controls live; after the preview stops, the host must be removed so they are clickable.
    await unmountAppliedPreviewFrame(page)
    await page.getByTestId('under-host').click()
  })
})
