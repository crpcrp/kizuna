export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

export function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
}

/** A string array no longer than `maxLength`. */
export function isStringArray(value: unknown, maxLength = Infinity): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxLength &&
    value.every((item) => typeof item === 'string')
  )
}

/** A finite-number array no longer than `maxLength`. */
export function isNumberArray(value: unknown, maxLength = Infinity): value is number[] {
  return Array.isArray(value) && value.length <= maxLength && value.every(isFiniteNumber)
}
