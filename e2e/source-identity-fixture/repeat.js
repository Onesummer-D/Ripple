// Plain .js is never annotated: it stands in for library code that renders a
// component it received as a prop, without JSX and without a Ripple boundary.
import { createElement, Fragment } from 'react'

export function Repeat({ component, count }) {
  return createElement(Fragment, null, Array.from({ length: count }, (_, index) => createElement(component, { key: index, n: index })))
}
