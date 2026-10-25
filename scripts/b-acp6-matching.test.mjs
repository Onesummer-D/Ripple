import test from 'node:test'
import assert from 'node:assert/strict'
import {
  consumerNodeMatches,
  evaluateAc62,
  evaluateAc64,
  matchExactRoutes,
  selectorClassTokens,
  strictTokenConsumerEdge,
} from './b-acp6-matching.mjs'

const declaration = { token: '--accent', file: 'src/theme.css', byteOffset: 12, selector: '[data-theme="light"]' }
const tokenNode = { id: 'token:light-accent', kind: 'token', label: '--accent', location: { path: declaration.file, byteOffset: 12, selectorScope: declaration.selector } }
const use = { token: '--accent', file: 'src/button.css', index: 44, byteOffset: 47, selector: '.btn-primary', consumerElements: [{ file: 'src/Button.jsx', elementOffset: 100, matchedClass: 'btn-primary', className: 'btn btn-primary', dynamic: false }] }
const consumer = { id: 'jsx:button', kind: 'jsx-element', location: { path: 'src/Button.jsx', start: 100 }, className: 'btn btn-primary' }
const validEdge = { id: 'edge:valid', kind: 'uses-token', from: tokenNode.id, to: consumer.id, sourceUse: { path: use.file, offset: use.index }, selectorScope: declaration.selector }

test('AC6.2 accepts only declaration + exact use-position + actual consumer edges', () => {
  assert.deepEqual(strictTokenConsumerEdge(validEdge, tokenNode, consumer, use, use.consumerElements[0], declaration), { matches: true, reason: null })
})

test('AC6.2 rejects unrelated edges even when they touch a token declaration', () => {
  const unrelated = { ...validEdge, from: 'file:unrelated.css', to: tokenNode.id }
  const outcome = strictTokenConsumerEdge(unrelated, tokenNode, consumer, use, use.consumerElements[0], declaration)
  const legacyWouldAccept = [unrelated].some(edge => edge.from === tokenNode.id || edge.to === tokenNode.id)
  assert.equal(legacyWouldAccept, true)
  assert.equal(outcome.matches, false)
  assert.equal(outcome.reason, 'endpoints-do-not-bind-token-to-consumer')
})

test('AC6.2 rejects wrong consumers and absent source-use provenance', () => {
  const wrongConsumer = { ...validEdge, to: 'jsx:other-button' }
  assert.equal(strictTokenConsumerEdge(wrongConsumer, tokenNode, consumer, use, use.consumerElements[0], declaration).matches, false)
  const wrongUse = { ...validEdge, sourceUse: { path: use.file, offset: use.index + 1 } }
  assert.equal(strictTokenConsumerEdge(wrongUse, tokenNode, consumer, use, use.consumerElements[0], declaration).matches, false)
})

test('AC6.2 rejects edges mapped to a different declaration scope', () => {
  const otherScope = { ...tokenNode, location: { ...tokenNode.location, selectorScope: ':root' } }
  assert.equal(strictTokenConsumerEdge(validEdge, otherScope, consumer, use, use.consumerElements[0], declaration).matches, false)
  const wrongScopeEdge = { ...validEdge, selectorScope: ':root' }
  assert.equal(strictTokenConsumerEdge(wrongScopeEdge, tokenNode, consumer, use, use.consumerElements[0], declaration).matches, false)
})

test('AC6.2 rejects omitted real consumers from full source-use coverage', () => {
  const report = evaluateAc62({
    declarations: [declaration],
    uses: [use],
    nodes: [tokenNode],
    edges: [validEdge],
  })
  assert.equal(report.pass, false)
  assert.equal(report.declarationSetCoverage[0].sourceUseCoverage[0].covered, false)
})

test('AC6.3 matches normalized route identity exactly, not path substrings', () => {
  const routes = [
    { id: 'route:about', kind: 'route', routePath: '/about' },
    { id: 'route:about-us', kind: 'route', routePath: '/about-us' },
  ]
  const about = matchExactRoutes(['/about'], routes)
  assert.equal(about.pass, true)
  const aboutUsOnly = [{ id: 'route:about-us', kind: 'route', routePath: '/about-us' }]
  const legacyWouldAccept = aboutUsOnly[0].routePath.includes('/about')
  const collision = matchExactRoutes(['/about'], aboutUsOnly)
  assert.equal(legacyWouldAccept, true)
  assert.equal(collision.pass, false)
})

test('AC6.3 rejects duplicate identities and node reuse', () => {
  assert.equal(matchExactRoutes(['/about'], [
    { id: 'a', kind: 'route', routePath: '/about' },
    { id: 'b', kind: 'route', path: '#/about/' },
  ]).pass, false)
  assert.equal(matchExactRoutes(['/about', '/about-us'], [
    { id: 'same', kind: 'route', routePath: '/about' },
  ]).pass, false)
})

test('AC6.4 matches class tokens exactly, including repeated class tokens', () => {
  assert.deepEqual(selectorClassTokens('[data-x=".not-a-class"] .btn-primary:hover'), ['btn-primary'])
  const pair = { file: 'src/Button.jsx', elementOffset: 100, matchedClass: 'btn', dynamic: false }
  const exact = { id: 'x', kind: 'jsx-element', location: { path: pair.file, start: 100 }, className: 'btn btn' }
  const substring = { ...exact, className: 'btn-primary' }
  assert.equal(consumerNodeMatches(pair, exact), true)
  assert.equal('btn-primary'.includes('btn'), true)
  assert.equal(consumerNodeMatches(pair, substring), false)
})

test('AC6.4 leaves dynamic and absent consumers unmatched', () => {
  const pair = { file: 'src/Button.jsx', elementOffset: 100, matchedClass: 'btn', dynamic: false }
  const node = { id: 'x', kind: 'jsx-element', location: { path: pair.file, start: 100 }, className: 'btn' }
  assert.equal(consumerNodeMatches({ ...pair, dynamic: true }, node), false)
  assert.equal(consumerNodeMatches(pair, { ...node, location: { path: pair.file, start: 101 } }), false)
  assert.equal(consumerNodeMatches(pair, { ...node, kind: 'component' }), false)
})


test('AC6.4 rejects an omitted real consumer even when another consumer edge exists', () => {
  const secondPair = { ...use.consumerElements[0], elementOffset: 200, sourceUses: [{ file: use.file, index: use.index, byteOffset: use.byteOffset }] }
  const pairA = { ...use.consumerElements[0], token: use.token, sourceUses: [{ file: use.file, index: use.index, byteOffset: use.byteOffset }] }
  const consumerA = consumer
  const consumerB = { id: 'jsx:second', kind: 'jsx-element', location: { path: 'src/Button.jsx', start: 200 }, className: 'btn-primary' }
  const report = evaluateAc64({
    pairs: [pairA, { ...secondPair, token: use.token }],
    declarations: [declaration],
    uses: [use],
    nodes: [tokenNode, consumerA, consumerB],
    edges: [validEdge],
  })
  assert.equal(report.pass, false)
  assert.equal(report.uncoveredConsumerPairs.length, 1)
  assert.equal(report.uncoveredConsumerPairs[0].elementOffset, 200)
})
