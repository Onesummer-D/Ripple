import { createHash } from 'node:crypto'
import type { BrowserControlRole, BrowserVerificationContract } from './model'

export class VerificationContractError extends Error {
  constructor(message: string) { super(message); this.name = 'VerificationContractError' }
}

export function verificationContractHash(contract: BrowserVerificationContract | undefined): string | undefined {
  return contract ? createHash('sha256').update(JSON.stringify(contract)).digest('hex') : undefined
}

function boundedText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 300) {
    throw new VerificationContractError(`${field} must contain 1–300 visible characters`)
  }
  return value.trim()
}

function role(value: unknown): BrowserControlRole {
  if (value !== 'button' && value !== 'link') throw new VerificationContractError('Browser contracts may activate buttons or links only')
  return value
}

function safePath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    throw new VerificationContractError('Contract page paths must be same-origin absolute paths')
  }
  const rawPathname = value.split(/[?#]/, 1)[0]
  for (const segment of rawPathname.split('/')) {
    let decodedSegment: string
    try { decodedSegment = decodeURIComponent(segment) }
    catch { throw new VerificationContractError('Contract page path contains invalid escaping') }
    if (decodedSegment === '..' || decodedSegment.includes('/') || decodedSegment.includes('\\')) {
      throw new VerificationContractError('Contract page path cannot traverse directories')
    }
  }
  let pathname: string
  try { pathname = decodeURIComponent(new URL(value, 'http://ripple.local').pathname) }
  catch { throw new VerificationContractError('Contract page path is invalid') }
  if (pathname.split('/').includes('..')) throw new VerificationContractError('Contract page path cannot traverse directories')
  return value
}

/** Validates the deliberately small, non-scriptable browser contract accepted by the local runner. */
export function normalizeVerificationContract(value: unknown, routeRefs: string[]): BrowserVerificationContract | undefined {
  if (value === undefined || value === null) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new VerificationContractError('Browser verification contract must be an object')
  const input = value as Record<string, unknown>
  if (!Array.isArray(input.pages) || !Array.isArray(input.interactions) || input.pages.length > 30 || input.interactions.length > 30) {
    throw new VerificationContractError('Contract requires pages and interactions arrays, each limited to 30 entries')
  }
  const pages = input.pages.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new VerificationContractError(`Contract page ${index + 1} is invalid`)
    const page = item as Record<string, unknown>
    const pageRef = boundedText(page.pageRef, `Contract page ${index + 1} pageRef`)
    if (!routeRefs.includes(pageRef)) throw new VerificationContractError(`Contract page is not present in this source graph: ${pageRef}`)
    let navigateBy: { role: BrowserControlRole; name: string } | undefined
    if (page.navigateBy !== undefined) {
      if (!page.navigateBy || typeof page.navigateBy !== 'object' || Array.isArray(page.navigateBy)) throw new VerificationContractError(`Contract page ${pageRef} navigation is invalid`)
      const navigation = page.navigateBy as Record<string, unknown>
      navigateBy = { role: role(navigation.role), name: boundedText(navigation.name, `Contract page ${pageRef} navigation name`) }
    }
    let menuControl: { role: BrowserControlRole; name: string } | undefined
    if (page.menuControl !== undefined) {
      if (!page.menuControl || typeof page.menuControl !== 'object' || Array.isArray(page.menuControl)) throw new VerificationContractError(`Contract page ${pageRef} menu control is invalid`)
      const menu = page.menuControl as Record<string, unknown>
      menuControl = { role: role(menu.role), name: boundedText(menu.name, `Contract page ${pageRef} menu control name`) }
    }
    return { pageRef, path: safePath(page.path), markerText: boundedText(page.markerText, `Contract page ${pageRef} markerText`), ...(navigateBy ? { navigateBy } : {}), ...(menuControl ? { menuControl } : {}) }
  })
  if (new Set(pages.map(page => page.pageRef)).size !== pages.length) throw new VerificationContractError('Contract page references must be unique')
  const interactions = input.interactions.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new VerificationContractError(`Contract interaction ${index + 1} is invalid`)
    const interaction = item as Record<string, unknown>
    const pageRef = boundedText(interaction.pageRef, `Contract interaction ${index + 1} pageRef`)
    if (!pages.some(page => page.pageRef === pageRef)) throw new VerificationContractError(`Interaction page is not probed by this contract: ${pageRef}`)
    return {
      pageRef,
      role: role(interaction.role),
      name: boundedText(interaction.name, `Contract interaction ${index + 1} name`),
      expectedText: boundedText(interaction.expectedText, `Contract interaction ${index + 1} expectedText`),
    }
  })
  return { pages, interactions }
}
