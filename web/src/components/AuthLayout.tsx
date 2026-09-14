import type { ReactNode } from 'react'
import Link from 'next/link'
import { AreaChart } from '@/components/charts/AreaChart'
import { Amount, Logo } from '@/components/ui'

const SAMPLE = [
  { label: 'Apr', value: 380 },
  { label: 'May', value: 460 },
  { label: 'Jun', value: 420 },
  { label: 'Jul', value: 540 },
  { label: 'Aug', value: 510 },
  { label: 'Sep', value: 650 },
]

/** The shared frame for sign-in and sign-up: the sage showcase panel on large screens, the form beside it. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="m-4 hidden flex-col justify-between overflow-hidden rounded-[36px] bg-sage-gradient p-10 text-white lg:flex">
        <Link href="/" aria-label="FundEd home">
          <Logo tone="light" />
        </Link>

        <div>
          <span className="inline-flex rounded-full bg-white/20 px-3 py-1 text-sm font-medium">Left over this month</span>
          <p className="mt-4 text-7xl font-medium tabular-nums tracking-display">
            <Amount value="$650.75" fadedClassName="text-white/45" />
          </p>
          <p className="mt-2 max-w-sm text-sm text-white/80">After rent, groceries and the money you send home to family.</p>
          <div className="mt-10">
            <AreaChart
              points={SAMPLE}
              height={150}
              tooltip={
                <div>
                  <p className="text-base font-semibold leading-none tracking-tight">$650.75</p>
                  <p className="mt-1 text-xs text-white/55">for September</p>
                </div>
              }
            />
          </div>
        </div>

        <h2 className="max-w-md text-4xl font-medium leading-[1.02] tracking-display">
          Know your hours, your budget, and the moment to send money home.
        </h2>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-9">
          <Link href="/" className="inline-block lg:hidden">
            <Logo />
          </Link>
          {children}
        </div>
      </main>
    </div>
  )
}
