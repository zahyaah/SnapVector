import { describe, expect, it } from 'vitest';

import { APP_NAME, describeBuild } from './version.js';

describe('describeBuild', () => {
  it('prefixes the version with the app name', () => {
    expect(describeBuild('0.1.0')).toBe(`${APP_NAME} 0.1.0`);
  });
});
