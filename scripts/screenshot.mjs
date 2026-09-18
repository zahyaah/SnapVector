// Visual verification harness. Boots the production build (never the dev server — a
// production build is what actually ships) and captures each theme at each breakpoint.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE_URL = process.env.SNAPVECTOR_URL ?? 'http://localhost:4173';
const OUT_DIR = process.env.SNAPVECTOR_SHOT_DIR ?? 'shots';
const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 780 },
  { name: 'desktop', width: 1280, height: 900 },
];

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();

for (const theme of ['light', 'dark']) {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: theme,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    const pressed = await page.getAttribute('#theme-toggle', 'aria-pressed');
    await page.screenshot({ path: `${OUT_DIR}/${theme}-${viewport.name}.png` });

    console.log(
      `${theme.padEnd(5)} ${viewport.name.padEnd(8)} aria-pressed=${pressed} ` +
        `errors=${errors.length ? errors.join(' | ') : 'none'}`,
    );
    await context.close();
  }
}

await browser.close();
