# Full Windows Vitest summary

Command: `npm test -- --run`

Exit code: `1`

Observed summary: `55` files passed, `15` files failed, `867` tests passed, `67` tests failed, `68` skipped, `6` unhandled errors.

Environment-caused failure classes:

- Playwright Chromium executable unavailable for verification-execution and visual-evidence browser suites.
- Windows sandbox denied symlink creation used by runtime identity and visual evidence tests.
- Windows sandbox denied hard-link creation in verification publish tests.
- Windows sandbox denied temporary Git initialization/config writes in project/resource tests.
- Loopback preview tests received `EACCES`/`fetch failed` on local ports.

The new `observation-host-trust-v1.test.ts` file passed `23/23`. No failure referenced either new production wrapper file.

Raw output from the final-source run is preserved in `full-vitest-windows.log`; the command exit code is appended as `EXIT_CODE=1`.
