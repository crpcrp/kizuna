/**
 * Removes HTML tags, replacing each with `replacement`. Repeats until stable
 * because removing one tag can expose another (`<<b>b>`). Entities are left
 * as they are.
 */
export function stripTags(value: string, replacement = ''): string {
  let stripped = value
  let previous: string
  do {
    previous = stripped
    stripped = stripped.replace(/<[^>]*>/g, replacement)
  } while (stripped !== previous)
  return stripped
}
