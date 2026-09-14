'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@apollo/client/react'
import { Bell, CalendarClock, Clock, ShieldAlert, TrendingUp } from 'lucide-react'
import { DASHBOARD } from '@/lib/queries'
import { buildNotifications, type AppNotification, type NotificationKind, type NotificationTone } from '@/lib/notifications'
import type { Profile } from '@/lib/session'
import type { DashboardData } from './dashboard/types'

const ICONS: Record<NotificationKind, typeof Bell> = {
  rate: TrendingUp,
  deadline: CalendarClock,
  hours: Clock,
  permit: ShieldAlert,
}

const TONES: Record<NotificationTone, string> = {
  danger: 'bg-red-50 text-red-600',
  warning: 'bg-amber-50 text-amber-700',
  success: 'bg-sage-100 text-sage-700',
}

/**
 * The header bell: a count of anything new, and a panel listing it.
 *
 * It reads the same DASHBOARD query the dashboard runs, with the same variables, so on the
 * dashboard it costs no extra request and updates whenever the dashboard refetches. Which
 * items have been seen is a per-browser convenience kept in localStorage, so it is read
 * defensively: a private window or blocked storage just means everything counts as new.
 */
export function NotificationBell({ profile }: { profile: Profile }) {
  const { data } = useQuery<DashboardData>(DASHBOARD, {
    variables: { upcomingDays: 30 },
    fetchPolicy: 'cache-first',
  })
  const [now] = useState(() => Date.now())
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState<Set<string>>(() => readSeen(profile.id))
  const [seenBeforeOpening, setSeenBeforeOpening] = useState<Set<string>>(seen)
  const container = useRef<HTMLDivElement>(null)

  const items: AppNotification[] = data ? buildNotifications(data.dashboard, profile, now) : []
  const unread = items.filter((item) => !seen.has(item.id)).length

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    // Remember what was new at the moment of opening, so those items keep their dot while
    // the panel is open even though they are now marked seen.
    setSeenBeforeOpening(seen)
    const next = new Set(items.map((item) => item.id))
    setSeen(next)
    writeSeen(profile.id, next)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        data-testid="notifications-button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications, ${unread} new` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Notifications"
        className="relative grid size-12 place-items-center rounded-full bg-white text-black/55 shadow-sm ring-1 ring-black/5 transition hover:text-ink hover:ring-black/15"
      >
        <Bell className="size-[18px]" />
        {unread > 0 && (
          <span
            data-testid="notifications-count"
            className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          data-testid="notifications-panel"
          // On a phone the bell sits left of the profile chip, so a panel anchored to the bell's
          // right edge spills off the left of the screen. Below sm it spans the viewport instead.
          className="fixed inset-x-4 top-20 z-40 overflow-hidden rounded-3xl bg-white shadow-[0_18px_40px_-12px_rgba(0,0,0,0.35)] ring-1 ring-black/5 sm:absolute sm:inset-x-auto sm:right-0 sm:top-14 sm:w-[22rem]"
        >
          <p className="px-5 pb-2 pt-4 font-medium text-ink">Notifications</p>
          {items.length === 0 ? (
            <div className="px-5 pb-5 text-sm text-black/50" data-testid="notifications-empty">
              <p className="font-medium text-ink">You&apos;re all caught up</p>
              <p className="mt-1 leading-relaxed">
                Rate alerts that fire, deadlines coming up and permit reminders appear here.{' '}
                <Link href="/dashboard#alerts" onClick={() => setOpen(false)} className="font-medium text-ink underline underline-offset-2">
                  Set a rate alert
                </Link>
              </p>
            </div>
          ) : (
            <ul className="max-h-96 overflow-y-auto pb-2" data-testid="notifications-list">
              {items.map((item) => {
                const Icon = ICONS[item.kind]
                return (
                  <li key={item.id}>
                    <Link href={item.href} onClick={() => setOpen(false)} className="flex items-start gap-3 px-5 py-3 transition hover:bg-tile">
                      <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${TONES[item.tone]}`}>
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink">{item.title}</span>
                        <span className="block text-xs text-black/50">{item.detail}</span>
                      </span>
                      {!seenBeforeOpening.has(item.id) && (
                        <span className="mt-2 size-2 shrink-0 rounded-full bg-red-600" aria-label="New" />
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

const storageKey = (userId: string) => `funded:seen-notifications:${userId}`

function readSeen(userId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeSeen(userId: string, ids: Set<string>): void {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify([...ids]))
  } catch {
    // Storage unavailable: the count simply resets on the next visit.
  }
}
