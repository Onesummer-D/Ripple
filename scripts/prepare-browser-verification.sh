#!/usr/bin/env bash
set -euo pipefail

# Image acquisition is an infrastructure step, never part of a candidate's
# bounded verification run. This is trusted Ripple code, not project code.
image='mcr.microsoft.com/playwright:v1.64.0-noble'
docker pull "$image"
docker run --rm --pull=never --init --network none --read-only \
  --user "$(id -u):$(id -g)" --env HOME=/tmp --env XDG_CACHE_HOME=/tmp/.cache \
  --memory 1g --cpus 2 --pids-limit 128 --cap-drop ALL \
  --security-opt no-new-privileges:true --shm-size 256m \
  --tmpfs "/tmp:rw,nosuid,nodev,size=1073741824,uid=$(id -u),gid=$(id -g)" \
  --mount "type=bind,source=$PWD/node_modules,target=/ripple/node_modules,readonly" \
  --workdir /ripple "$image" node --input-type=module -e '
    import { chromium } from "/ripple/node_modules/playwright/index.mjs";
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.setContent("<main>Ripple browser runtime ready</main>");
      if (await page.locator("main").innerText() !== "Ripple browser runtime ready") process.exitCode = 1;
      await page.close();
    } finally {
      await browser.close();
    }
  '
