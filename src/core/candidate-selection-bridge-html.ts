/** Inject the real picker script as literal text into Vite preview HTML.
 * React's __reactFiber$ and __reactInternalInstance$ source strings contain "$'",
 * which String.replace interprets as the suffix of the HTML input when
 * supplied as a replacement string. The callback prevents that corruption.
 */
export function insertCandidateSelectionBridge(html: string, script: string): string {
  return html
    .replace(/<script\b(?=[^>]*\bsrc=["']\/@vite\/client["'])[^>]*>\s*<\/script>/g, '')
    .replace('</body>', () => `${script}</body>`)
}
