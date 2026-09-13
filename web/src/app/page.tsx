import Link from 'next/link'
import { ArrowRight, BellRing, BriefcaseBusiness, HandCoins, PiggyBank } from 'lucide-react'
import { Amount, Logo } from '@/components/ui'
import { AreaChart } from '@/components/charts/AreaChart'

const SAMPLE_WEEKS = [
  { label: 'Jul 20', value: 9 },
  { label: 'Jul 27', value: 14 },
  { label: 'Aug 3', value: 11 },
  { label: 'Aug 10', value: 18 },
  { label: 'Aug 17', value: 15 },
  { label: 'Aug 24', value: 21 },
  { label: 'Aug 31', value: 17 },
  { label: 'Sep 7', value: 22 },
]

const FEATURES = [
  {
    icon: BriefcaseBusiness,
    title: 'Permit hours',
    body: 'Log shifts and see how much of your weekly off-campus cap is left, before you accept the next one.',
  },
  {
    icon: HandCoins,
    title: 'Money home',
    body: 'Keep what you send to family in its own currency, right next to what you spend here.',
  },
  {
    icon: BellRing,
    title: 'Rate alerts',
    body: 'Set the exchange rate you are waiting for and hear the moment it arrives.',
  },
]

export default function Home() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-20 max-w-6xl items-center justify-between px-6">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/cost-of-living/halifax" className="rounded-full px-4 py-2 text-sm text-black/55 transition hover:text-ink">
            Cost of living
          </Link>
          <Link
            href="/login"
            data-testid="nav-sign-in"
            className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-ink shadow-sm ring-1 ring-black/5 transition hover:ring-black/15"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 pb-20">
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="relative flex min-h-[720px] flex-col overflow-hidden rounded-[40px] bg-hero-fade px-8 pt-12 sm:px-12">
            <p className="relative z-10 text-center text-sm font-medium text-white/85">For international students in Canada</p>
            <h1 className="relative z-10 mx-auto mt-5 max-w-lg text-center text-5xl font-medium leading-[0.95] tracking-display text-white sm:text-6xl lg:text-7xl">
              Modern tools for money abroad
            </h1>
            <CardOnMoss />
            <div className="relative z-10 mb-8 mt-auto flex items-center gap-3">
              <Link
                href="/login"
                data-testid="get-started"
                className="flex h-14 flex-1 items-center justify-center rounded-full bg-white text-base font-medium text-ink shadow-lg transition hover:bg-white/90"
              >
                Get started
              </Link>
              <Link
                href="/login"
                aria-label="Sign in"
                className="grid size-14 place-items-center rounded-full bg-white text-ink shadow-lg transition hover:bg-white/90"
              >
                <ArrowRight className="size-5" />
              </Link>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="flex flex-1 flex-col rounded-[32px] bg-sage-gradient p-7 text-white sm:p-8">
              <span className="inline-flex w-fit rounded-full bg-white/20 px-3 py-1 text-sm font-medium">92% of your weekly cap</span>
              <p className="mt-4 text-6xl font-medium tracking-display sm:text-7xl">
                22<span className="text-white/45"> / 24</span>
              </p>
              <p className="mt-2 text-sm text-white/80">Off-campus hours this week</p>
              <div className="mt-auto pt-10">
                <AreaChart
                  points={SAMPLE_WEEKS}
                  height={160}
                  threshold={{ value: 24, label: 'Cap 24 h' }}
                  tooltip={
                    <div>
                      <p className="text-base font-semibold leading-none tracking-tight">22 h</p>
                      <p className="mt-1 text-xs text-white/55">this week</p>
                    </div>
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <PreviewTile label="Sent home this month" value="₹25,000.00" icon={<HandCoins className="size-[18px]" />} />
              <PreviewTile label="Left over each month" value="$650.75" icon={<PiggyBank className="size-[18px]" />} />
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <article key={title} className="rounded-[28px] bg-white p-7 shadow-[0_18px_44px_-28px_rgba(16,24,16,0.3)]">
              <span className="grid size-11 place-items-center rounded-full bg-tile text-ink">
                <Icon className="size-5" />
              </span>
              <h2 className="mt-6 text-xl font-semibold tracking-tight text-ink">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-black/55">{body}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  )
}

function PreviewTile({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <article className="flex min-h-40 flex-col rounded-[28px] bg-white p-5 shadow-[0_18px_44px_-28px_rgba(16,24,16,0.3)]">
      <div className="flex items-start justify-between gap-2 text-black/40">
        <p className="text-[13px] leading-snug text-black/55">{label}</p>
        {icon}
      </div>
      <p className="mt-auto pt-6 text-2xl font-semibold tabular-nums tracking-tight text-ink sm:text-[26px]">
        <Amount value={value} />
      </p>
    </article>
  )
}

/** A black card resting on moss, drawn entirely in CSS so the page needs no image assets. */
function CardOnMoss() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[44%]">
      <div className="absolute left-1/2 top-[-14%] h-44 w-72 -translate-x-1/2 rotate-[-22deg] rounded-[22px] bg-[linear-gradient(135deg,#3b3b3b_0%,#151515_45%,#050505_100%)] shadow-[0_45px_60px_-20px_rgba(0,0,0,0.65)] sm:h-48 sm:w-80">
        <div className="absolute left-7 top-8 h-9 w-11 rounded-md bg-[linear-gradient(135deg,#e4e4e0,#9d9d98)] opacity-90" />
        <div className="absolute left-[3.1rem] top-8 h-9 w-px bg-black/25" />
        <div className="absolute left-7 top-[3.05rem] h-px w-11 bg-black/25" />
        <div className="absolute bottom-8 right-8 h-4 w-32 -skew-x-12 rounded-sm bg-white/[0.08]" />
        <div className="absolute bottom-14 right-14 h-3 w-16 -skew-x-12 rounded-sm bg-white/[0.06]" />
      </div>
      <div className="absolute -bottom-28 left-1/2 h-80 w-[135%] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(ellipse_at_42%_28%,#7a9a52_0%,#46632e_42%,#253a17_78%)]" />
      <div className="absolute -bottom-12 left-[10%] h-48 w-80 rounded-[46%] bg-[radial-gradient(ellipse_at_50%_22%,#86a65c_0%,#4d6a31_52%,#2a3f19_88%)]" />
      <div className="absolute -bottom-16 right-[4%] h-52 w-72 rounded-[48%] bg-[radial-gradient(ellipse_at_50%_24%,#739447_0%,#3f5a28_56%,#223314_92%)]" />
      {[
        ['left-[22%] bottom-[34%]', 'bg-pink-300'],
        ['left-[30%] bottom-[28%]', 'bg-pink-200'],
        ['right-[24%] bottom-[30%]', 'bg-rose-300'],
        ['right-[16%] bottom-[24%]', 'bg-pink-300'],
        ['left-[62%] bottom-[20%]', 'bg-red-400'],
      ].map(([position, colour]) => (
        <span key={position} className={`absolute size-2.5 rounded-full ${position} ${colour} shadow-[0_0_6px_rgba(255,255,255,0.4)]`} />
      ))}
    </div>
  )
}
