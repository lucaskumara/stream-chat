import { describe, expect, it } from 'vitest'
import { resolvedTheme } from '@/theme'

describe('resolvedTheme', () => {
  it('takes an explicit choice whatever the OS asks for', () => {
    expect(resolvedTheme('dark', false)).toBe('dark')
    expect(resolvedTheme('light', true)).toBe('light')
  })

  it('follows the OS only for system', () => {
    expect(resolvedTheme('system', true)).toBe('dark')
    expect(resolvedTheme('system', false)).toBe('light')
  })
})
