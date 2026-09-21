// Accessibility and responsive-overflow gate. Fails the process on any axe violation or
// any width where the document scrolls horizontally.
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

const BASE_URL = process.env.SNAPVECTOR_URL ?? 'http://localhost:4173';
const WIDTHS = [360, 768, 1440];
const THEMES = ['light', 'dark'];
// A test fixture, not a real user asset — used only to reach the "loaded" state below,
// since the toolbar and its buttons are `[hidden]` (and so invisible to axe entirely)
// until an image is loaded.
const FIXTURE =
  '/private/tmp/claude-501/-Users-kzaydahmed-Desktop-OpenSourced-SnapVector/7298fa07-9b73-4f07-895c-9e362be927b3/scratchpad/fixtures/circle.png';

const STATES = [
  { name: 'empty', prepare: null },
  {
    name: 'loaded',
    prepare: async (page) => {
      await page.setInputFiles('#file-input', FIXTURE);
      await page.waitForSelector('.stage[data-state="loaded"]');
    },
  },
];

const browser = await chromium.launch();
let failures = 0;

for (const state of STATES) {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: theme,
      });
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await state.prepare?.(page);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const bad = overflow > 0 || violations.length > 0;
      if (bad) failures++;
      console.log(
        `${bad ? 'FAIL' : 'ok  '} ${state.name.padEnd(6)} ${theme.padEnd(5)} ${String(width).padStart(4)}px  ` +
          `overflow=${overflow}px  violations=${violations.length}`,
      );
      for (const v of violations) {
        console.log(`       ${v.id} (${v.impact}): ${v.help}`);
        for (const node of v.nodes) console.log(`         ${node.target.join(' ')}`);
      }
      await context.close();
    }
  }
}

await browser.close();
if (failures > 0) {
  console.error(`\n${failures} configuration(s) failed`);
  process.exit(1);
}
console.log('\nno violations, no horizontal overflow, across every state');
