import { expect, test } from '@playwright/test'
import { assertDesktopPreviewViewport, clickDesktopNavTarget } from './applied-preview-navigation'

const footerMarker = '山野器物 · Ripple UI验收'
const navLabels = ['秋日手作节', '商品专题', '品牌故事'] as const

/** Replicates the real Bolt conflict structure: desktop nav inside <nav>, a mobile
 * menu outside <nav>, same-name footer buttons and a same-name body CTA. */
function fixtureHtml(options: { omitNavLabel?: string } = {}): string {
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
    ${navButtons.map(label => `<button data-nav="${label}">${label}</button>`).join('\n    ')}
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
