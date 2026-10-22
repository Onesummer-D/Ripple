import { expect, type Frame, type FrameLocator, type Page } from '@playwright/test'

export type AppliedPreviewRoot = Frame | FrameLocator | Page

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
