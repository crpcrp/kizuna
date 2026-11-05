import { describe, expect, it } from 'vitest'
import {
  isFiniteNumber,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isRecord
} from '../../src/shared/guards'

describe('isRecord', () => {
  it('accepts plain objects and rejects arrays, null and primitives', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord(undefined)).toBe(false)
    expect(isRecord('x')).toBe(false)
  })
})

describe('isFiniteNumber', () => {
  it('accepts finite numbers only', () => {
    expect(isFiniteNumber(0)).toBe(true)
    expect(isFiniteNumber(-1.5)).toBe(true)
    expect(isFiniteNumber(Number.NaN)).toBe(false)
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isFiniteNumber('1')).toBe(false)
  })
})

describe('isPositiveSafeInteger', () => {
  it('accepts safe integers above zero', () => {
    expect(isPositiveSafeInteger(1)).toBe(true)
    expect(isPositiveSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(true)
    expect(isPositiveSafeInteger(0)).toBe(false)
    expect(isPositiveSafeInteger(-1)).toBe(false)
    expect(isPositiveSafeInteger(1.5)).toBe(false)
    expect(isPositiveSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toBe(false)
    expect(isPositiveSafeInteger('1')).toBe(false)
  })
})

describe('isNonNegativeSafeInteger', () => {
  it('accepts safe integers at or above zero', () => {
    expect(isNonNegativeSafeInteger(0)).toBe(true)
    expect(isNonNegativeSafeInteger(1)).toBe(true)
    expect(isNonNegativeSafeInteger(-1)).toBe(false)
    expect(isNonNegativeSafeInteger(1.5)).toBe(false)
    expect(isNonNegativeSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toBe(false)
    expect(isNonNegativeSafeInteger(Number.NaN)).toBe(false)
  })
})
