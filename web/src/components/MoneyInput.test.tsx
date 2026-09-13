import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MoneyInput, formatMinor, parseMoneyToMinor } from './MoneyInput'

describe('parseMoneyToMinor', () => {
  it.each([
    ['2500', 250_000],
    ['2,500', 250_000],
    ['$2,500.50', 250_050],
    ['1200.', 120_000],
    ['0.5', 50],
    ['.75', 75],
    ['', 0],
  ])('reads %s as %i minor units', (text, minor) => {
    expect(parseMoneyToMinor(text)).toBe(minor)
  })

  it.each(['abc', '12a', '1.234', '1.2.3', '-5'])('rejects %s', (text) => {
    expect(parseMoneyToMinor(text)).toBeNull()
  })
})

describe('formatMinor', () => {
  it('shows cents and thousands separators', () => {
    expect(formatMinor(120_050)).toBe('1,200.50')
  })
})

describe('MoneyInput', () => {
  // The reported bug: typing one key at a time, the decimal point disappeared.
  it('keeps a decimal point while typing, one key at a time', () => {
    const onChange = vi.fn()
    render(<MoneyInput id="income" testId="income" valueMinor={0} onChange={onChange} />)
    const input = screen.getByTestId('income') as HTMLInputElement

    let typed = ''
    for (const key of '1200.50') {
      typed += key
      fireEvent.change(input, { target: { value: typed } })
    }

    expect(input.value).toBe('1200.50')
    expect(onChange).toHaveBeenLastCalledWith(120_050)
  })

  it('accepts amounts well above $200', () => {
    const onChange = vi.fn()
    render(<MoneyInput id="rent" testId="rent" valueMinor={0} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('rent'), { target: { value: '15,000' } })
    expect(onChange).toHaveBeenLastCalledWith(1_500_000)
  })

  it('ignores a keystroke that is not money instead of clearing the field', () => {
    const onChange = vi.fn()
    render(<MoneyInput id="x" testId="x" valueMinor={0} onChange={onChange} />)
    const input = screen.getByTestId('x') as HTMLInputElement
    fireEvent.change(input, { target: { value: '45' } })
    fireEvent.change(input, { target: { value: '45z' } })
    expect(input.value).toBe('45')
  })

  it('formats neatly when the field loses focus', () => {
    render(<MoneyInput id="y" testId="y" valueMinor={250_000} onChange={() => {}} />)
    const input = screen.getByTestId('y') as HTMLInputElement
    fireEvent.blur(input)
    expect(input.value).toBe('2,500.00')
  })
})
