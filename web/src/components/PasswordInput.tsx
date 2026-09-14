'use client'

import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { TextInput } from './ui'

/** A password field with a show/hide toggle, so a long passphrase can be checked before submitting. */
export function PasswordInput({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <TextInput {...props} type={visible ? 'text' : 'password'} className={`pr-12 ${className}`} />
      <button
        type="button"
        onClick={() => setVisible((shown) => !shown)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        data-testid={props.id ? `${props.id}-toggle` : undefined}
        className="absolute inset-y-0 right-2 my-auto grid size-9 place-items-center rounded-full text-black/40 transition hover:text-ink"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}
