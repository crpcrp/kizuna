/** @param {unknown} value @returns {boolean} */
export const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** @param {unknown} value @returns {boolean} */
export const nonemptyString = (value) => typeof value === 'string' && value.trim().length > 0

/**
 * Predicates keep manifest constraints beside their fields; failures identify the field.
 * @param {any} value
 * @param {Record<string, (value: any) => boolean>} spec
 * @param {string} [label]
 * @returns {string[]}
 */
export function requireShape(value, spec, label = 'manifest') {
  if (!isPlainObject(value)) return [`${label} must be an object`]
  return Object.entries(spec)
    .filter(([key, accepts]) => !accepts(value[key]))
    .map(([key]) => `${label}.${key} is invalid`)
}
