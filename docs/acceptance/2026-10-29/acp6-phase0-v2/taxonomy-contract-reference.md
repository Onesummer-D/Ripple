# AC-P6 taxonomy contract reference

This archive uses the signed A contract verbatim by reference:

- repository: `Onesummer-D/Ripple`
- branch: `evidence/acp6-taxonomy-v1-20261029`
- commit: `6deb7a263fe45e45ab06bdc617f5a8be2da31a1d`
- path: `docs/architecture/acp6-gap-taxonomy-v1-2026-10-29.md`
- blob: `d99c0c6bc0699fd8980007d7aef2a8a801ae2565`
- taxonomyVersion: `acp6-gap-taxonomy/v1`
- mappingVersion: `acp6-gap-mapping/v1`

The canonical `gapClass` vocabulary is exactly:

1. `global-or-theme-selector`
2. `no-static-element-anchor`
3. `dynamic-or-ambiguous-class`
4. `candidate-without-source-edge`
5. `pseudo-element-or-generated-content`

The raw labels are retained separately in `rawGapClass` and `rawGapClasses`:

- `selector-owner-unresolved`
- `dynamic-className`
- `theme-cascade-ambiguity`
- `complex-selector-normalization`
- `candidate-without-strict-edge`

This evidence archive records the signed contract commit/blob instead of copying or changing the contract document. The matrix builder applies the contract's selector and AC6.4 evidence rules; it does not rename a merged legacy label mechanically. `secondaryReasons` and all raw labels remain in each uncovered row.
