# Host Registry issuer v1

The issuer and verifier are isolated Node modules. The host must compose the
issuer with its registry entries and Ed25519 private key in controlled server
code. A registration pins a project ID, repository identity, local checkout
root, commit, root tree and SourceDigest. The repository identity is an exact
registry value. Git remote configuration does not establish ownership.

The issuing closure accepts only a project ID. It selects the registered
checkout, captures an immutable committed snapshot using the existing
Git object reader, and compares the captured root, commit, root tree and
SourceDigest with the registration before signing. A missing project, invalid
checkout, dirty worktree or capture failure yields no receipt. A captured tuple
that differs from the registration is rejected. Duplicate project registrations
fail at initialization.

The verification closure takes a public key and an expected binding once from
trusted composition. Its per-call input is the untrusted receipt. The key ID
is the lowercase SHA-256 of the public key's DER SPKI bytes. It identifies the
pinned key and does not select a key from the receipt. Verification copies the
five binding fields, checks the signature with the pinned key and compares the
whole tuple. A self-issued receipt from another key cannot pass, even with a
copy of the genuine project registration.

## Signed bytes

The payload is the ASCII prefix `ripple/host-registry/project-snapshot/v1`
followed by one NUL byte, then UTF-8 compact JSON of this ordered array:

```json
["ripple-host-registry-receipt/v1","<keyId>","<projectId>","<repository>","<gitHead>","<rootTree>","<sourceDigest>"]
```

The receipt has exactly four fields: `version`, `keyId`, `binding`, and
`signature`. The signature is unpadded canonical Base64URL of 64 Ed25519
signature bytes. Git object IDs use lowercase hexadecimal in the same object
format. SourceDigest uses the existing snapshot algorithm. This versioned
signature payload is separate from GraphDigestV2 and its ten-field input.

## Verification scope

`verified` records the authenticity and exact identity of the project snapshot
tuple under the configured public key. The receipt can be checked again against
the same pinned tuple, so it carries no freshness, run/check identity or
observation lineage. The module has no result for runtime proof, authorization
or host-bound-complete. Product integration and key provisioning require a
separate review of host composition and key custody.

Run the controlled Git and Ed25519 fixtures with:

```sh
npm test -- --run src/core/host-registry-issuer-v1.test.ts src/core/graph-identity-v2.test.ts
npm run typecheck
```
