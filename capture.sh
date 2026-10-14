#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ -z "${CAPTURE_URL:-}" ]]; then echo "CAPTURE_URL is required" >&2; exit 1; fi
if [[ -z "${CAPTURE_DIR:-}" ]]; then echo "CAPTURE_DIR is required" >&2; exit 1; fi
/usr/bin/time -p mkdir -p "$CAPTURE_DIR"
/usr/bin/time -p test -n "$CAPTURE_URL"
RUNNER_TMP="${RUNNER_TEMP:-/tmp}"
/usr/bin/time -p mkdir -p "$RUNNER_TMP"
HELPER="$RUNNER_TMP/omgithub-capture-$$.mjs"
/usr/bin/time -p tee "$HELPER" > /dev/null <<'NODEJS'
import { readFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const url = process.env.CAPTURE_URL;
const output = process.env.CAPTURE_DIR;
if (!url || !output) { console.error('Set CAPTURE_URL and CAPTURE_DIR.'); process.exit(1); }
const runtime = join(process.env.HOME, '.local/share/omgithub-playwright');
const require = createRequire(join(runtime, 'package.json'));
const { chromium } = require('playwright');
let config;
try { config = JSON.parse(readFileSync(join(runtime, 'linux.json'), 'utf8')); }
catch (e) { console.error('Failed to read playwright config: ' + e.message); process.exit(1); }
if (process.platform === 'linux') {
  try { process.env.DISPLAY ||= ':' + readFileSync(join(runtime, 'display'), 'utf8').trim(); }
  catch (e) { console.error('Failed to read display: ' + e.message); process.exit(75); }
}
mkdirSync(output, { recursive: true });
const transient = (err) => { console.error('Transient capture failure:', err?.message || err); process.exit(75); };
let browser;
try {
  browser = await chromium.launch({ ...(config.browser?.launchOptions || {}), timeout: 30000 }).catch(transient);
  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }).catch(transient);
    page.setDefaultTimeout(30000);
    page.on('pageerror', (e) => console.error(e.message));
    const response = await page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch(transient);
    const status = response?.status();
    if (!response || !response.ok()) {
      const code = !response || [408, 429, 500, 502, 503, 504].includes(status) ? 75 : 1;
      console.error(`HTTP ${status} loading preview`);
      process.exit(code);
    }
    try {
      await page.locator('body').waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 30000 });
    } catch (e) {
      console.error('Rendering defect: content did not become visible: ' + e.message);
      process.exit(1);
    }
    await page.waitForTimeout(1000);
    const dest = join(output, `final-${name}.png`);
    await page.screenshot({ path: dest, timeout: 30000 }).catch((e) => {
      if (e.name === 'TimeoutError' || !browser.isConnected()) transient(e);
      console.error(e);
      process.exit(1);
    });
    try {
      const st = statSync(dest);
      if (st.size < 5000) { console.error(`Rendering defect: ${dest} too small (${st.size} bytes)`); process.exit(1); }
    } catch (e) { console.error('Screenshot missing: ' + e.message); process.exit(1); }
    console.log(`Captured ${name} -> ${dest}`);
    await page.close();
  }
} catch (e) {
  if (e && typeof e.exitCode === 'number') process.exit(e.exitCode);
  console.error(e);
  process.exit(e?.exitCode || 1);
} finally {
  await browser?.close().catch((e) => { console.error(e); process.exitCode ||= 75; });
}
NODEJS
/usr/bin/time -p node --version
/usr/bin/time -p node "$HELPER"
STATUS=$?
/usr/bin/time -p rm -f "$HELPER"
/usr/bin/time -p ls -lh "$CAPTURE_DIR/final-desktop.png" "$CAPTURE_DIR/final-mobile.png"
exit $STATUS
