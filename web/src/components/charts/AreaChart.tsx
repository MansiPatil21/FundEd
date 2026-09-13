import { useId, type ReactNode } from 'react'

/**
 * A smooth area chart for dark green surfaces, with one highlighted point carrying a black
 * tooltip, as in the design.
 *
 * The SVG stretches to its box (preserveAspectRatio="none") so it fills any card width
 * without measuring the DOM. Anything that must keep its proportions, such as the dot, the
 * tooltip and the labels, is HTML positioned by percentage on top, and strokes use
 * non-scaling-stroke so stretching never fattens a line.
 */

export interface ChartPoint {
  label: string
  value: number
}

interface AreaChartProps {
  points: ChartPoint[]
  highlightIndex?: number
  tooltip?: ReactNode
  threshold?: { value: number; label: string }
  height?: number
  testId?: string
}

/** Share of the height kept clear above the tallest point, so the tooltip has room. */
const TOP = 40
const BOTTOM = 6

export function AreaChart({
  points,
  highlightIndex = points.length - 1,
  tooltip,
  threshold,
  height = 200,
  testId,
}: AreaChartProps) {
  const gradientId = `area-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  if (points.length === 0) return null

  const max = Math.max(1, threshold?.value ?? 0, ...points.map((point) => point.value)) * 1.08
  const x = (index: number) => (points.length === 1 ? 50 : (index / (points.length - 1)) * 100)
  const y = (value: number) => TOP + (1 - value / max) * (100 - TOP - BOTTOM)

  const coords = points.map((point, index) => [x(index), y(point.value)] as const)
  const line = smoothPath(coords)
  const area = `${line} L 100 100 L 0 100 Z`

  const safeIndex = Math.min(Math.max(highlightIndex, 0), coords.length - 1)
  const [hx, hy] = coords[safeIndex]!
  const anchor = hx > 78 ? 0.88 : hx < 22 ? 0.12 : 0.5

  return (
    <div data-testid={testId} className="w-full">
      <div className="relative" style={{ height }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
          {threshold && (
            <line
              x1="0"
              x2="100"
              y1={y(threshold.value)}
              y2={y(threshold.value)}
              stroke="#ffffff"
              strokeOpacity="0.6"
              strokeWidth="1.25"
              strokeDasharray="4 5"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <line x1={hx} x2={hx} y1={hy} y2="100" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path
            d={line}
            fill="none"
            stroke="#ffffff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Left-aligned: the highlighted point is usually the latest one, on the right, and its
            tooltip would otherwise cover this label. */}
        {threshold && (
          <span
            className="absolute left-0 -translate-y-full pb-1 text-[11px] font-medium text-white/80"
            style={{ top: `${y(threshold.value)}%` }}
          >
            {threshold.label}
          </span>
        )}

        <span
          className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-ink shadow"
          style={{ left: `${hx}%`, top: `${hy}%` }}
        />

        {tooltip && (
          <div
            className="absolute z-10"
            style={{ left: `${hx}%`, top: `${hy}%`, transform: `translate(-${anchor * 100}%, calc(-100% - 16px))` }}
          >
            <div className="relative whitespace-nowrap rounded-2xl bg-ink px-4 py-3 text-white shadow-xl">
              {tooltip}
              <span
                className="absolute top-full size-3 -translate-x-1/2 -translate-y-1.5 rotate-45 bg-ink"
                style={{ left: `${anchor * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 flex justify-between text-[11px] text-white/70">
        {points.map((point, index) => (
          <span key={`${point.label}-${index}`} className={points.length > 6 && index % 2 === 1 ? 'hidden sm:inline' : ''}>
            {point.label}
          </span>
        ))}
      </div>
    </div>
  )
}

const clamp = (value: number) => Math.min(100, Math.max(0, value))

/** A smooth curve through the points (Catmull-Rom converted to cubic Béziers). */
export function smoothPath(points: ReadonlyArray<readonly [number, number]>): string {
  const first = points[0]
  if (!first) return ''
  if (points.length === 1) return `M 0 ${first[1]} L 100 ${first[1]}`

  const tension = 0.18
  let d = `M ${first[0]} ${first[1]}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[i + 2] ?? p2
    const c1x = p1[0] + (p2[0] - p0[0]) * tension
    const c1y = clamp(p1[1] + (p2[1] - p0[1]) * tension)
    const c2x = p2[0] - (p3[0] - p1[0]) * tension
    const c2y = clamp(p2[1] - (p3[1] - p1[1]) * tension)
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`
  }
  return d
}
