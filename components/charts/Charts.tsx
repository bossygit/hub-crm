import type { CSSProperties } from 'react'
import {
  barRects,
  chartScaleMax,
  donutSegments,
  formatCompactFcfa,
  lineChartPoints,
  svgDashArray,
  toAreaPath,
  toLinePath,
  CHART_PALETTE,
} from '@/lib/reports/charts'

/**
 * Graphiques SVG sans dépendance externe.
 * Composants purement présentationnels (aucun hook) : utilisables aussi bien
 * dans un composant serveur (rapports) que client (tableau de bord).
 */

export type ChartPoint = { label: string; value: number }

const AXIS = '#e8e4db'
const GRID = '#f0ece4'
const TEXT = '#8a8a8a'

function fmtDefault(value: number): string {
  return formatCompactFcfa(value)
}

// ── Courbe ──────────────────────────────────────────────────────────

export function LineChart({
  points,
  height = 220,
  color = '#2d6a4f',
  valueFormatter = fmtDefault,
  yTicks = 4,
}: {
  points: ChartPoint[]
  height?: number
  color?: string
  valueFormatter?: (value: number) => string
  yTicks?: number
}) {
  const W = 600
  const H = height
  const PAD_LEFT = 52
  const PAD_RIGHT = 12
  const PAD_TOP = 14
  const PAD_BOTTOM = 28
  const innerW = W - PAD_LEFT - PAD_RIGHT
  const innerH = H - PAD_TOP - PAD_BOTTOM

  if (points.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#999', fontSize: '0.85rem' }}>Aucune donnée</div>
  }

  const values = points.map(p => p.value)
  const max = chartScaleMax(values)
  const geometry = lineChartPoints(values, innerW, innerH, max, 0)
  const shifted = geometry.map(p => ({ ...p, x: p.x + PAD_LEFT, y: p.y + PAD_TOP }))
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => (max * i) / yTicks).reverse()
  const labelEvery = Math.ceil(points.length / 12)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Évolution">
      {/* Grille + axe Y */}
      {ticks.map((tick, i) => {
        const y = PAD_TOP + (innerH * i) / yTicks
        return (
          <g key={`t-${i}`}>
            <line x1={PAD_LEFT} y1={y} x2={W - PAD_RIGHT} y2={y} stroke={GRID} strokeWidth={1} />
            <text x={PAD_LEFT - 8} y={y + 3} textAnchor="end" fontSize={10} fill={TEXT}>{valueFormatter(tick)}</text>
          </g>
        )
      })}

      {/* Aire + courbe */}
      <path d={toAreaPath(shifted, PAD_TOP + innerH)} fill={color} opacity={0.1} />
      <path d={toLinePath(shifted)} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

      {/* Points + infobulles */}
      {shifted.map((p, i) => (
        <g key={`p-${i}`}>
          <circle cx={p.x} cy={p.y} r={3} fill="white" stroke={color} strokeWidth={2}>
            <title>{`${points[i].label} : ${valueFormatter(points[i].value)}`}</title>
          </circle>
        </g>
      ))}

      {/* Axe X */}
      <line x1={PAD_LEFT} y1={PAD_TOP + innerH} x2={W - PAD_RIGHT} y2={PAD_TOP + innerH} stroke={AXIS} strokeWidth={1} />
      {points.map((p, i) => {
        if (i % labelEvery !== 0 && i !== points.length - 1) return null
        const x = PAD_LEFT + (points.length > 1 ? (innerW * i) / (points.length - 1) : innerW / 2)
        return <text key={`x-${i}`} x={x} y={H - 8} textAnchor="middle" fontSize={10} fill={TEXT}>{p.label}</text>
      })}
    </svg>
  )
}

// ── Barres ──────────────────────────────────────────────────────────

export function BarChart({
  points,
  height = 220,
  color = '#2d6a4f',
  valueFormatter = fmtDefault,
}: {
  points: ChartPoint[]
  height?: number
  color?: string
  valueFormatter?: (value: number) => string
}) {
  const W = 600
  const H = height
  const PAD_LEFT = 52
  const PAD_RIGHT = 12
  const PAD_TOP = 14
  const PAD_BOTTOM = 42
  const innerW = W - PAD_LEFT - PAD_RIGHT
  const innerH = H - PAD_TOP - PAD_BOTTOM

  if (points.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#999', fontSize: '0.85rem' }}>Aucune donnée</div>
  }

  const max = chartScaleMax(points.map(p => p.value))
  const rects = barRects(points.map(p => p.value), innerW, innerH, max, 10)
  const ticks = [0, 0.5, 1]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Répartition">
      {ticks.map((ratio, i) => {
        const y = PAD_TOP + innerH * (1 - ratio)
        return (
          <g key={`g-${i}`}>
            <line x1={PAD_LEFT} y1={y} x2={W - PAD_RIGHT} y2={y} stroke={GRID} strokeWidth={1} />
            <text x={PAD_LEFT - 8} y={y + 3} textAnchor="end" fontSize={10} fill={TEXT}>{valueFormatter(max * ratio)}</text>
          </g>
        )
      })}
      {rects.map((r, i) => (
        <rect key={`b-${i}`} x={r.x + PAD_LEFT} y={r.y + PAD_TOP} width={r.width} height={r.height} rx={3} fill={color} opacity={0.85}>
          <title>{`${points[i].label} : ${valueFormatter(points[i].value)}`}</title>
        </rect>
      ))}
      <line x1={PAD_LEFT} y1={PAD_TOP + innerH} x2={W - PAD_RIGHT} y2={PAD_TOP + innerH} stroke={AXIS} strokeWidth={1} />
      {points.map((p, i) => {
        const slot = innerW / points.length
        const x = PAD_LEFT + slot * i + slot / 2
        const label = p.label.length > 12 ? `${p.label.slice(0, 11)}…` : p.label
        return <text key={`x-${i}`} x={x} y={H - 26} textAnchor="middle" fontSize={9.5} fill={TEXT} transform={`rotate(-18 ${x} ${H - 26})`}>{label}</text>
      })}
    </svg>
  )
}

// ── Anneau (donut) ──────────────────────────────────────────────────

export function DonutChart({
  points,
  size = 190,
  thickness = 26,
  centerLabel,
  centerValue,
  colors = CHART_PALETTE,
}: {
  points: ChartPoint[]
  size?: number
  thickness?: number
  centerLabel?: string
  centerValue?: string
  colors?: string[]
}) {
  const segments = donutSegments(
    points.map((p, i) => ({ key: `${p.label}-${i}`, label: p.label, value: p.value })),
    colors,
  )
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const center = size / 2
  const total = points.reduce((s, p) => s + (Number(p.value) || 0), 0)

  if (total <= 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#999', fontSize: '0.85rem' }}>Aucune donnée</div>
  }

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, display: 'block' }} role="img" aria-label="Répartition">
      <g transform={`rotate(-90 ${center} ${center})`}>
        {segments.map(seg => (
          <circle
            key={seg.key}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth={thickness}
            strokeDasharray={svgDashArray(seg.percent, circumference)}
            strokeDashoffset={-seg.offset * circumference}
          >
            <title>{`${seg.label} : ${formatCompactFcfa(seg.value)} (${Math.round(seg.percent * 100)}%)`}</title>
          </circle>
        ))}
      </g>
      <text x={center} y={center - 2} textAnchor="middle" fontSize={13} fontWeight={700} fill="#1a3d2b">{centerValue}</text>
      <text x={center} y={center + 15} textAnchor="middle" fontSize={9.5} fill={TEXT}>{centerLabel}</text>
    </svg>
  )
}

export function ChartLegend({
  points,
  colors = CHART_PALETTE,
  valueFormatter = fmtDefault,
  style,
}: {
  points: ChartPoint[]
  colors?: string[]
  valueFormatter?: (value: number) => string
  style?: CSSProperties
}) {
  const total = points.reduce((s, p) => s + (Number(p.value) || 0), 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...style }}>
      {points.map((p, i) => (
        <div key={`${p.label}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem' }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: colors[i % colors.length], flexShrink: 0 }} />
          <span style={{ flex: 1, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
          <span style={{ fontWeight: 700, color: '#1a3d2b' }}>{valueFormatter(p.value)}</span>
          <span style={{ color: '#999', minWidth: 34, textAlign: 'right' }}>
            {total > 0 ? `${Math.round((p.value / total) * 100)}%` : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}
