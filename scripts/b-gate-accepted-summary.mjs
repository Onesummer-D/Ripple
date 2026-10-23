/** Accepted-pass predicate for the codescandy gate — PURE and testable.
 *
 *  P0-1 lesson: metadata fields (SHAs, paths, strings) must NEVER sit inside
 *  the boolean groups that decide `pass`. A single string field made every
 *  genuine ACCEPTED verdict evaluate to false. This module checks booleans
 *  ONLY; all metadata lives outside, in the report envelope.
 *
 *  Contract: pass === true  iff
 *    - the candidate was actually created, and
 *    - every value in acceptance.verification is strictly true, and
 *    - every value in acceptance.scopeVerification is strictly true, and
 *    - every value in postChecks is strictly true.
 */
export const acceptedPass = (acceptance, postChecks) => {
  if (!acceptance || acceptance.created !== true) return false
  const groups = [acceptance.verification ?? {}, acceptance.scopeVerification ?? {}, postChecks ?? {}]
  return groups.every(group => Object.values(group).every(value => value === true))
}
