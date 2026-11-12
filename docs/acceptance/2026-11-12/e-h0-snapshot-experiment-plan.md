# E-H0 Snapshot Evidence Experiment

This evidence-only experiment is based on source commit
da89402738b3f46aeea1dc9eedaa5231a22fd571 and is run from the independent
experiment branch e/e-h0-snapshot-experiment-20261113.

The workflow commit and the analyzed source commit are recorded separately.
The experiment captures the analyzed checkout HEAD, root tree, tracked set,
per-file byte SHA-256 values, and the existing sourceDigest byte contract.

The experiment attempts all of the following before running analyzeProject:

- a separate baseline clone;
- per-component symlink and regular-file checks;
- stable file reads with descriptor identity checks;
- filesystem immutable flags where supported;
- a read-only bind mount;
- internal and external write, replacement, symlink, and path escape probes;
- a mutate-then-restore probe to show why digest equality alone is insufficient;
- strace file-read evidence for the Analyzer process.

The result is evidence-only. FEASIBLE is emitted only if the immutable
mechanism, Analyzer byte binding, and fail-closed negative cases all pass.
Otherwise the result remains NOT_PROVEN. Host Registry issuer absence keeps
host proof and authorization unavailable in every result.

