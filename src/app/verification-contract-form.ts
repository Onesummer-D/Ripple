import type { BrowserControlRole, BrowserVerificationContract } from '../core/model'

export interface VerificationContractDraft {
  pages: Array<{
    pageRef: string
    path: string
    markerText: string
    navigationRole: BrowserControlRole
    navigationName: string
  }>
  interactions: Array<{
    id: string
    pageRef: string
    role: BrowserControlRole
    name: string
    expectedText: string
  }>
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
        path: saved?.path ?? '/',
        markerText: saved?.markerText ?? '',
        navigationRole: saved?.navigateBy?.role ?? 'button',
        navigationName: saved?.navigateBy?.name ?? '',
      }
    }),
    interactions: (contract?.interactions ?? []).map((interaction, index) => ({
      id: `interaction-${index}`,
      ...interaction,
    })),
  }
}

export function toBrowserVerificationContract(draft: VerificationContractDraft): BrowserVerificationContract | undefined {
  const pages = draft.pages
    .filter(page => page.path.trim() && page.markerText.trim())
    .map(({ pageRef, path, markerText, navigationRole, navigationName }) => ({
      pageRef,
      path: path.trim(),
      markerText: markerText.trim(),
      ...(navigationName.trim() ? { navigateBy: { role: navigationRole, name: navigationName.trim() } } : {}),
    }))
  const declaredPages = new Set(pages.map(page => page.pageRef))
  const interactions = draft.interactions
    .filter(interaction => declaredPages.has(interaction.pageRef) && interaction.name.trim() && interaction.expectedText.trim())
    .map(({ pageRef, role, name, expectedText }) => ({ pageRef, role, name: name.trim(), expectedText: expectedText.trim() }))
  return pages.length || interactions.length ? { pages, interactions } : undefined
}

export function incompleteVerificationDeclarations(draft: VerificationContractDraft): number {
  const incompletePages = draft.pages.filter(page => !!page.markerText.trim() && !(page.path.trim() && page.markerText.trim())).length
  const declaredPages = new Set(draft.pages.filter(page => page.path.trim() && page.markerText.trim()).map(page => page.pageRef))
  const incompleteInteractions = draft.interactions.filter(interaction =>
    !!(interaction.name.trim() || interaction.expectedText.trim()) &&
    !(declaredPages.has(interaction.pageRef) && interaction.name.trim() && interaction.expectedText.trim()),
  ).length
  return incompletePages + incompleteInteractions
}
