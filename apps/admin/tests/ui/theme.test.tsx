// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setTheme, storedTheme, useTheme } from '../../src/lib/theme'

function Probe() { return <p>theme:{useTheme()}</p> }

beforeEach(() => {
  cleanup()                                   // no vitest globals here, so unmount the previous test's screen by hand
  localStorage.clear()
  delete document.documentElement.dataset.theme
  document.head.innerHTML = '<meta name="theme-color" content="#101418">'
})
afterEach(() => { vi.restoreAllMocks() })

describe('the device theme', () => {
  it('starts classic, with no attribute on the page', () => {
    expect(storedTheme()).toBe('classic')
    render(<Probe />)
    expect(screen.getByText('theme:classic')).toBeTruthy()
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('switches the page, the phone status-bar colour and every reader at once, and remembers it', () => {
    render(<Probe />)
    act(() => setTheme('2100'))
    expect(document.documentElement.dataset.theme).toBe('2100')
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe('#090d16')
    expect(screen.getByText('theme:2100')).toBeTruthy()
    expect(storedTheme()).toBe('2100')

    act(() => setTheme('classic'))
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(localStorage.getItem('mpe.theme')).toBeNull()
    expect(screen.getByText('theme:classic')).toBeTruthy()
  })

  it('still applies the theme when the device blocks storage, and reads as classic instead of crashing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => setTheme('2100')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('2100')
    expect(storedTheme()).toBe('classic')
  })
})
