/**
 * Sanitizes a caught value into a short, user-facing message. Never surfaces
 * `err.stack` or an arbitrary `String(err)` of a non-Error thrown value —
 * both could leak internals into the UI.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return 'Something went wrong.'
}
