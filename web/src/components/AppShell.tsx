'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { BriefcaseBusiness, ChartPie, LogOut, Send, TrendingUp, UserRound } from 'lucide-react'
import { chosenName, signOut, type Profile } from '@/lib/session'
import { NotificationBell } from './NotificationBell'
import { Logo } from './ui'

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: ChartPie },
  { href: '/dashboard#shifts', label: 'Shifts', icon: BriefcaseBusiness },
  { href: '/dashboard#plan', label: 'Plan transfers', icon: Send },
  // Not a bell: the bell in the header is notifications, and two bells meant two different things.
  { href: '/dashboard#alerts', label: 'Rate alerts', icon: TrendingUp },
  { href: '/profile', label: 'Profile', icon: UserRound },
] as const

export function AppShell({ profile, children }: { profile: Profile; children: ReactNode }) {
  const pathname = usePathname()
  const name = chosenName(profile) || profile.email
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-4 px-6">
        <Link href="/dashboard" aria-label="FundEd home">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <NotificationBell profile={profile} />
          <Link
            href="/profile"
            data-testid="profile-chip"
            className="flex min-w-0 items-center gap-3 rounded-full bg-white py-1.5 pl-1.5 pr-1.5 shadow-sm ring-1 ring-black/5 transition hover:ring-black/15 sm:pr-4"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sage-gradient text-xs font-semibold text-white">
              {initials || '?'}
            </span>
            <span className="hidden max-w-48 truncate text-sm font-medium text-ink sm:block">{name}</span>
          </Link>
          <button
            data-testid="sign-out"
            onClick={signOut}
            aria-label="Sign out"
            title="Sign out"
            className="grid size-12 place-items-center rounded-full bg-white text-black/55 shadow-sm ring-1 ring-black/5 transition hover:text-ink hover:ring-black/15"
          >
            <LogOut className="size-[18px]" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-36 pt-2">{children}</main>

      {/* Floating pill navigation, with the current page as a solid black circle. */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-5 z-30 flex justify-center px-4">
        <div className="flex items-center gap-1 rounded-full bg-white/90 p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.35)] ring-1 ring-black/5 backdrop-blur">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                title={label}
                aria-current={active ? 'page' : undefined}
                className={`grid size-12 place-items-center rounded-full transition ${
                  active ? 'bg-ink text-white' : 'text-black/55 hover:bg-tile hover:text-ink'
                }`}
              >
                <Icon className="size-5" strokeWidth={1.8} />
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
