import { expect, type Frame, type FrameLocator, type Page } from '@playwright/test'

export type AppliedPreviewRoot = Frame | FrameLocator | Page

/**
 * Mount the applied project preview so that the iframe is ALWAYS fully inside
 * the outer browser viewport.
 *
 * Run #17 root cause: a `position: fixed` header inside a nested iframe whose
 * iframe is clipped by the outer viewport never passes Playwright's actionability
 * check — the composed quads of fixed descendants oscillate frame-to-frame, so
 * `locator.click()` waits forever at "waiting for element to be visible, enabled
 * and stable" even though the page layout is completely static. Mounting the
 * iframe in a fixed host container keeps it fully visible and the same click
 * passes. The iframe keeps its exact 1280x800 content viewport and its sandbox.
 */
export async function mountAppliedPreviewFrame(page: Page, url: string): Promise<void> {
  await page.evaluate(target => {
    document.getElementById('applied-preview-host')?.remove()
    const host = document.createElement('div')
    host.id = 'applied-preview-host'
    host.style.cssText = 'position: fixed; top: 0; left: 0; width: 1280px; height: 800px; z-index: 2147483647; background: #fff;'
    const frame = document.createElement('iframe')
    frame.id = 'applied-bolt-preview'
    frame.title = 'Applied Bolt project'
    frame.sandbox.add('allow-scripts')
    frame.style.cssText = 'display: block; width: 1280px; height: 800px; border: 0;'
    frame.src = target
    host.append(frame)
    document.body.append(host)
  }, url)
}

/** Assert the mounted iframe is fully inside the outer interactable viewport. */
export async function assertAppliedPreviewInteractable(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const frame = document.getElementById('applied-bolt-preview')
    if (!frame) return undefined
    const rect = frame.getBoundingClientRect()
    return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, outerWidth: window.innerWidth, outerHeight: window.innerHeight }
  })
  expect(geometry, 'applied preview frame must be mounted before the interactability check').toBeTruthy()
  expect(geometry!.top, 'applied preview iframe must be fully inside the outer viewport (Run #17: clipped iframe + fixed header = unactionable)').toBeGreaterThanOrEqual(0)
  expect(geometry!.left, 'applied preview iframe must be fully inside the outer viewport').toBeGreaterThanOrEqual(0)
  expect(geometry!.bottom, `applied preview iframe bottom must be within the outer viewport height ${geometry!.outerHeight}`).toBeLessThanOrEqual(geometry!.outerHeight)
  expect(geometry!.right, `applied preview iframe right edge must be within the outer viewport width ${geometry!.outerWidth}`).toBeLessThanOrEqual(geometry!.outerWidth)
}

/** Remove the applied preview host so underlying workbench controls are reachable again. */
export async function unmountAppliedPreviewFrame(page: Page): Promise<void> {
  await page.evaluate(() => document.getElementById('applied-preview-host')?.remove())
  await expect(page.locator('#applied-preview-host')).toHaveCount(0)
}

/**
 * Click the unique visible desktop-navigation button for `label`.
 *
 * The locator is scoped to the navigation landmark and enforced to resolve to
 * exactly one element, so hidden controls, footer/body same-name buttons and
 * duplicated nav entries can never be mistaken for a successful navigation.
 * Failures fail fast (15s) and attach a diagnostic dump of every same-name
 * button so a hidden or ambiguous target is obvious from the report.
 */
export async function clickDesktopNavTarget(root: AppliedPreviewRoot, label: string): Promise<void> {
  const inNav = root.getByRole('navigation').getByRole('button', { name: label, exact: true })
  try {
    await expect(inNav, `desktop navigation must resolve to exactly one visible '${label}' button`).toBeVisible({ timeout: 15_000 })
    await inNav.click({ timeout: 15_000 })
  } catch (error) {
    const report = await root.getByRole('button', { name: label, exact: true, includeHidden: true }).evaluateAll(buttons => buttons.map(button => {
      const style = getComputedStyle(button)
      const rect = button.getBoundingClientRect()
      return {
        inNavigation: !!button.closest('nav'),
        display: style.display,
        visibility: style.visibility,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    })).catch(failure => `unavailable: ${String(failure)}`)
    throw new Error(`desktop navigation to '${label}' failed: ${error instanceof Error ? error.message : String(error)}\nsame-name buttons in applied preview (includeHidden): ${JSON.stringify(report)}`)
  }
}

/**
 * Prove that the applied preview actually renders at the intended desktop
 * viewport. Run #16 showed that a size-less iframe collapses to ~300px and
 * flips the real project into its mobile layout, so the inner viewport is
 * asserted before any navigation is attempted.
 */
export async function assertDesktopPreviewViewport(root: AppliedPreviewRoot): Promise<{ width: number; height: number }> {
  await expect.poll(
    () => root.locator('body').evaluate(() => window.innerWidth),
    { timeout: 15_000, message: 'applied preview must keep the desktop layout (inner width at least 1200px)' },
  ).toBeGreaterThanOrEqual(1200)
  const viewport = await root.locator('body').evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  expect(viewport.height, `applied preview inner height must be at least 700px, actual ${viewport.height}`).toBeGreaterThanOrEqual(700)
  return viewport
}
