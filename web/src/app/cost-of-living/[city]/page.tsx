import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Bus, House, ShoppingCart, Smartphone } from 'lucide-react'
import { Logo } from '@/components/ui'

/**
 * Public, server-rendered cost-of-living pages.
 *
 * The one part of the product a prospective student reads before having an account, which
 * makes it the one part where search engines matter. Rendering on the server puts the
 * numbers in the HTML rather than behind a client fetch, and generateStaticParams pre-builds
 * the cities we cover.
 */

interface CityCosts {
  name: string
  province: string
  monthly: { rent: number; groceries: number; transit: number; phone: number }
  note: string
}

const CITIES: Record<string, CityCosts> = {
  halifax: {
    name: 'Halifax',
    province: 'Nova Scotia',
    monthly: { rent: 1_450, groceries: 400, transit: 82, phone: 45 },
    note: 'A shared flat well outside the peninsula is materially cheaper than a studio near campus.',
  },
  toronto: {
    name: 'Toronto',
    province: 'Ontario',
    monthly: { rent: 2_200, groceries: 450, transit: 156, phone: 50 },
    note: 'Rent dominates everything else. A longer commute is usually the largest single saving available.',
  },
  montreal: {
    name: 'Montreal',
    province: 'Quebec',
    monthly: { rent: 1_300, groceries: 380, transit: 97, phone: 45 },
    note: 'Lower rent than comparable cities, but budget for French-language requirements in some programs.',
  },
}

const ICONS = { rent: House, groceries: ShoppingCart, transit: Bus, phone: Smartphone } as const

export function generateStaticParams() {
  return Object.keys(CITIES).map((city) => ({ city }))
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city } = await params
  const found = CITIES[city]
  if (!found) return { title: 'Unknown city · FundEd' }

  const total = Object.values(found.monthly).reduce((sum, value) => sum + value, 0)
  return {
    title: `Cost of living for students in ${found.name} · FundEd`,
    description: `Roughly $${total.toLocaleString()} per month for a student in ${found.name}, ${found.province}: rent, groceries, transit and phone.`,
  }
}

export default async function CostOfLivingPage({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params
  const found = CITIES[city]
  if (!found) notFound()

  const entries = Object.entries(found.monthly) as Array<[keyof CityCosts['monthly'], number]>
  const total = entries.reduce((sum, [, value]) => sum + value, 0)

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-20 max-w-4xl items-center justify-between px-6">
        <Link href="/" aria-label="FundEd home">
          <Logo />
        </Link>
        <Link
          href="/login"
          className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-ink shadow-sm ring-1 ring-black/5 transition hover:ring-black/15"
        >
          Sign in
        </Link>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-6 pb-16">
        <section className="rounded-[36px] bg-sage-gradient p-8 text-white sm:p-10">
          <p className="text-sm text-white/75">{found.province}, Canada</p>
          <h1 className="mt-2 text-5xl font-medium tracking-display sm:text-6xl">Studying in {found.name}</h1>
          <p className="mt-3 max-w-lg text-white/80">{found.note}</p>
          <div className="mt-10 inline-flex flex-col rounded-3xl bg-ink px-6 py-5 shadow-xl">
            <span className="text-sm text-white/55">Monthly total</span>
            <span data-testid="monthly-total" className="mt-1 text-4xl font-semibold tabular-nums tracking-tight">
              ${total.toLocaleString()}
            </span>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {entries.map(([label, amount]) => {
            const Icon = ICONS[label]
            return (
              <article key={label} className="flex min-h-40 flex-col rounded-[28px] bg-white p-5 shadow-[0_18px_44px_-28px_rgba(16,24,16,0.3)]">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] capitalize text-black/55">{label}</p>
                  <Icon className="size-[18px] text-black/35" />
                </div>
                <p className="mt-auto pt-6 text-3xl font-semibold tabular-nums tracking-tight text-ink">${amount.toLocaleString()}</p>
                <p className="mt-1 text-xs text-black/40">{Math.round((amount / total) * 100)}% of the month</p>
              </article>
            )
          })}
        </section>

        <p className="px-2 text-xs text-black/45">
          Indicative figures for planning, gathered for orientation rather than measured. Rents in particular vary enough that your
          own search will beat any published average.
        </p>
      </main>
    </div>
  )
}
