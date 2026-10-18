# Isolated candidate preview platform

Ripple's candidate preview runs the target site's Vite server in a Linux Docker container. The container uses the target project's `node_modules` and Ripple's preview dependencies read-only; those native packages must match the container's Linux platform.

On Windows, run both Ripple and the target project from a WSL2 Linux distribution with Docker Desktop's WSL integration enabled. Keep both checkouts and their `node_modules` under the WSL Linux filesystem (for example, `~/src`), not under `/mnt/c` or a Windows checkout. Install dependencies in that Linux environment using the project's lockfile, after reviewing and trusting its dependency scripts. Start Ripple's development server from WSL and open its `http://localhost:<port>` address in the Windows browser. Ripple refuses to start the isolated preview from a non-Linux Node process instead of mounting Windows-native binaries into a Linux container.

The Linux/Docker route is exercised by the required GitHub Actions browser suite. This checkout did not have Docker available on Windows, so the WSL2/Docker Desktop route itself has not been locally verified. A future Linux dependency preparation/cache workflow could remove this host-platform constraint; Ripple does not currently run target-project install scripts automatically.
