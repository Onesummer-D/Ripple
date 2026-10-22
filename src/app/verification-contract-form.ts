import type { BrowserControlRole, BrowserVerificationContract } from '../core/model'

export interface VerificationContractDraft {
  pages: Array<{
    pageRef: string
    path: string
    markerText: string
    navigationRole: BrowserControlRole
    navigationName: string
    menuRole: BrowserControlRole
    menuName: string
  }>
  interactions: Array<{
    id: string
    pageRef: string
    role: BrowserControlRole
    name: string
    expectedText: string
  }>
}

export interface VerificationMarkerTarget {
  id: string
  kind: 'data' | 'media' | 'token'
  value?: string
  pageOverrides?: Record<string, string>
  impact: {
    pageRefs: string[]
    unresolved: string[]
    certainty: 'source-proven' | 'partial' | 'unknown'
  }
}

export function suggestVerificationPageMarkers(
  routes: Array<{ id: string }>,
  targets: VerificationMarkerTarget[],
  editedTargetRefs: string[],
): Record<string, string[]> {
  const routeRefs = new Set(routes.map(route => route.id))
  const editedRefs = new Set(editedTargetRefs)
  const valuesByPage = new Map<string, Map<string, { occurrences: number; singlePageTargets: number }>>()

  for (const target of targets) {
    const pageRefs = target.impact.pageRefs
    if (editedRefs.has(target.id) || target.kind !== 'data' || target.impact.certainty !== 'source-proven' || target.impact.unresolved.length !== 0 || !pageRefs.length || pageRefs.some(pageRef => !routeRefs.has(pageRef))) continue
    for (const pageRef of pageRefs) {
      const text = (target.pageOverrides?.[pageRef] ?? target.value)?.trim()
      if (!text || text.length > 300) continue
      const values = valuesByPage.get(pageRef) ?? new Map<string, { occurrences: number; singlePageTargets: number }>()
      const current = values.get(text) ?? { occurrences: 0, singlePageTargets: 0 }
      values.set(text, { occurrences: current.occurrences + 1, singlePageTargets: current.singlePageTargets + Number(pageRefs.length === 1) })
      valuesByPage.set(pageRef, values)
    }
  }

  return Object.fromEntries(routes.map(route => [
    route.id,
    [...(valuesByPage.get(route.id) ?? new Map())].filter(([, count]) => count.occurrences === 1 && count.singlePageTargets === 1).map(([text]) => text),
  ]))
}

export function createVerificationContractDraft(
  routes: Array<{ id: string }>,
  contract?: BrowserVerificationContract,
): VerificationContractDraft {
  return {
    pages: routes.map(route => {
      const saved = contract?.pages.find(page => page.pageRef === route.id)
      return {
        pageRef: route.id,
        path: saved?.path ?? '',
        markerText: saved?.markerText ?? '',
        navigationRole: saved?.navigateBy?.role ?? 'button',
        navigationName: saved?.navigateBy?.name ?? '',
        menuRole: saved?.menuControl?.role ?? 'button',
        menuName: saved?.menuControl?.name ?? '',
      }
    }),
    interactions: (contract?.interactions ?? []).map((interaction, index) => ({
      id: `interaction-${index}`,
      ...interaction,
    })),
  }
}

export function rebaseVerificationContractDraft(
  routes: Array<{ id: string }>,
  draft: VerificationContractDraft,
): VerificationContractDraft {
  const previousPages = new Map(draft.pages.map(page => [page.pageRef, page]))
  const routeRefs = new Set(routes.map(route => route.id))
  return {
    pages: routes.map(route => previousPages.get(route.id) ?? {
      pageRef: route.id,
      path: '',
      markerText: '',
      navigationRole: 'button',
      navigationName: '',
      menuRole: 'button',
      menuName: '',
    }),
    interactions: draft.interactions.filter(interaction => routeRefs.has(interaction.pageRef)),
  }
}

export function toBrowserVerificationContract(draft: VerificationContractDraft): BrowserVerificationContract | undefined {
  const pages = draft.pages
    .filter(page => page.path.trim() && page.markerText.trim())
    .map(({ pageRef, path, markerText, navigationRole, navigationName, menuRole, menuName }) => ({
      pageRef,
      path: path.trim(),
      markerText: markerText.trim(),
      ...(navigationName.trim() ? { navigateBy: { role: navigationRole, name: navigationName.trim() } } : {}),
      ...(menuName.trim() ? { menuControl: { role: menuRole, name: menuName.trim() } } : {}),
    }))
  const declaredPages = new Set(pages.map(page => page.pageRef))
  const interactions = draft.interactions
    .filter(interaction => declaredPages.has(interaction.pageRef) && interaction.name.trim() && interaction.expectedText.trim())
    .map(({ pageRef, role, name, expectedText }) => ({ pageRef, role, name: name.trim(), expectedText: expectedText.trim() }))
  return pages.length || interactions.length ? { pages, interactions } : undefined
}

export function incompleteVerificationDeclarations(draft: VerificationContractDraft): number {
  const incompletePages = draft.pages.filter(page => !!page.path.trim() !== !!page.markerText.trim()).length
  const declaredPages = new Set(draft.pages.filter(page => page.path.trim() && page.markerText.trim()).map(page => page.pageRef))
  const incompleteInteractions = draft.interactions.filter(interaction =>
    !!(interaction.name.trim() || interaction.expectedText.trim()) &&
    !(declaredPages.has(interaction.pageRef) && interaction.name.trim() && interaction.expectedText.trim()),
  ).length
  return incompletePages + incompleteInteractions
}
