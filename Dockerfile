# Ripple workbench — local Docker run
#
# The REAL adapter's isolated project preview / four-viewport verification shells
# out to the `docker` CLI and requires:
#   1. a Linux runtime  (assertPreviewPlatform: process.platform === 'linux')
#   2. reachability to the preview container's IP (host relay on :5173)
#   3. the host Docker daemon available (we point DOCKER_HOST at the Windows host
#      daemon exposed over TCP by Docker Desktop)
#
# For the e2e runner we therefore launch this image with `--network host` so the
# Ripple process shares the Docker host's network and can reach preview containers
# by IP. For the interactive app we publish a port and run in DEMO mode (no Docker
# needed to click through the four-step flow UI).

FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# docker CLI: Ripple's REAL adapter runs `docker` to spin up isolated
# preview/verification containers on the host daemon.
RUN apt-get update \
 && apt-get install -y --no-install-recommends docker.io ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Playwright browser for the test runner itself (the verification image pulled at
# runtime via the host daemon is separate).
RUN npx playwright install chromium

ENV RIPPLE_WORKBENCH_STATE_DIR=/app/.ripple-state
ENV DOCKER_HOST=tcp://host.docker.internal:2375

EXPOSE 4173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "4173", "--strictPort"]
