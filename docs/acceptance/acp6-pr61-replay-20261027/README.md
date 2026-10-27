# PR #61 AC-P6 replay evidence

Evidence branch: evidence/pr61-acp6-replay-20261027
Branch base / PR #61 tested HEAD: 28d76e8cb44c5f697ce868ce44bfa8b5287b6273
Prior comparison SHA: 1a2ec305bba0caa3877e4773feabe06c0605115c
B probe/matcher baseline: 0c02b85cdf7b1d52821fee3e06c013cbd664efa8
Fixed sample: allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd
Fixed src/css/style.css SHA-256: 8de0b6c59beb8538534adcbd5bb20906bda6b6ca7b9e3998702a229a2506a920

Replay command (run from the B/A source snapshot):
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs ./scripts/b-css-token-probe.mjs <fixed-project-root> --acceptance --json <acceptance.json> --expect-core-sha <core-sha>

Results for both 1a2ec305 and 28d76e8:
status=PENDING; PASS=2; PENDING=3; ERROR=0; exit=2.
AC6.1 PASS; AC6.2 PENDING; AC6.3 PENDING; AC6.4 PENDING; AC6.5 PASS.
Graph: 650 nodes, 4656 edges, 253 unresolved.
AC6.4: 147 source-positioned consumer pairs, 53 uncovered; dynamic class files include src/layouts/Nav.jsx and src/pages/Home.jsx; componentLevelEdgesTotal=0.
AC6.2: 8 source tokens, only --skill-color fully covered; 7 tokens remain uncovered and multiple source uses have linkedStrictEdges=0.
AC6.3: seven expected routes, pageNodes=[] and all seven graphNodeIds=[].
AC6.5: three --accent-color fallback uses retained as unknown at offsets 12715, 12991, 13078.
No Candidate/Verification/Approval/Apply/Rollback changes were made.
