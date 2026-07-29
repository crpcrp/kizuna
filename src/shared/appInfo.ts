// Shared, pure logic usable from any process (main / preload / renderer / tests).
// Kept tiny on purpose — it exists so the smoke-test window has one real,
// testable function, satisfying the "every function is tested" rule in AGENTS.md.

import { PRODUCT_NAME } from './appIdentity'

/** Re-exported so UI code has one obvious name to import; the value itself is
 * owned by `appIdentity.json`. */
export const APP_NAME = PRODUCT_NAME

/** Formats the string shown in the window / title bar. */
export function appTitle(version: string): string {
  return `${APP_NAME} v${version}`
}
