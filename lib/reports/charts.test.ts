import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMonthlyRevenueSeries,
  buildCategoryRevenueSeries,
  buildTopClientsSeries,
  monthKeyOf,
  monthLabel,
  chartScaleMax,
  formatCompactFcfa,
  lineChartPoints,
  toLinePath,
  toAreaPath,
  barRects,
  donutSegments,
  svgDashArray,
  CATEGORY_FALLBACK,
} from './charts.ts'

const now = new Date(2026, 8, 15) // 15/09/2026

describe('monthKeyOf / monthLabel', () => {
  it('extrait la clé mois', () => {
    assert.equal(monthKeyOf('2026-09-15'), '2026-09')
    assert.equal(monthKeyOf('2026-09-15T10:00:00Z'), '2026-09')
    assert.equal(monthKeyOf(''), null)
    assert.equal(monthKeyOf(null), null)
  })

  it('formate un libellé de mois non vide', () => {
    assert.ok(monthLabel('2026-09').length > 0)
    assert.equal(monthLabel('invalide'), 'invalide')
  })
})

describe('buildMonthlyRevenueSeries', () => {
  const invoices = [
    { id: 'i1', date: '2026-09-01', status: 'approved', total: 100 },
    { id: 'i2', date: '2026-09-20', status: 'paid', total: 50 },
    { id: 'i3', date: '2026-08-10', status: 'partial', total: 200 },
    { id: 'i4', date: '2026-07-05', status: 'draft', total: 999 },
    { id: 'i5', date: '2026-06-01', status: 'approved', total: 999 },
  ]

  it('regroupe le CA validé par mois, en ordre chronologique', () => {
    const series = buildMonthlyRevenueSeries(invoices, { months: 3, now })
    assert.deepEqual(series.map(p => p.key), ['2026-07', '2026-08', '2026-09'])
    assert.deepEqual(series.map(p => p.revenue), [0, 200, 150])
    assert.deepEqual(series.map(p => p.count), [0, 1, 2])
  })

  it('ignore les brouillons et les mois hors fenêtre', () => {
    const series = buildMonthlyRevenueSeries(invoices, { months: 2, now })
    assert.deepEqual(series.map(p => p.key), ['2026-08', '2026-09'])
    assert.equal(series.reduce((s, p) => s + p.revenue, 0), 350)
  })

  it('renvoie une série vide mais complète sans facture', () => {
    const series = buildMonthlyRevenueSeries([], { months: 4, now })
    assert.equal(series.length, 4)
    assert.ok(series.every(p => p.revenue === 0 && p.count === 0))
  })
})

describe('buildCategoryRevenueSeries', () => {
  const products = [
    { id: 'p1', category: 'Épicerie' },
    { id: 'p2', category: 'Emballages' },
    { id: 'p3', category: null },
  ]
  const invoices = [
    { id: 'i1', date: '2026-09-01', status: 'approved', total: 0 },
    { id: 'i2', date: '2026-09-02', status: 'draft', total: 0 },
  ]
  const items = [
    { invoice_id: 'i1', product_id: 'p1', quantity: 2, subtotal: 100 },
    { invoice_id: 'i1', product_id: 'p1', quantity: 1, subtotal: 50 },
    { invoice_id: 'i1', product_id: 'p2', quantity: 5, subtotal: 300 },
    { invoice_id: 'i1', product_id: 'p3', quantity: 1, subtotal: 20 },
    { invoice_id: 'i1', product_id: null, quantity: 1, subtotal: 10 },
    { invoice_id: 'i2', product_id: 'p1', quantity: 99, subtotal: 9999 },
  ]

  it('agrège par catégorie en écartant les brouillons', () => {
    const series = buildCategoryRevenueSeries(items, products, invoices)
    assert.equal(series[0].category, 'Emballages')
    assert.equal(series[0].revenue, 300)
    const epicerie = series.find(s => s.category === 'Épicerie')
    assert.equal(epicerie?.revenue, 150)
    assert.equal(epicerie?.quantity, 3)
    const fallback = series.find(s => s.category === CATEGORY_FALLBACK)
    assert.equal(fallback?.revenue, 30)
  })
})

describe('buildTopClientsSeries', () => {
  const clients = [{ id: 'c1', name: 'Alpha' }, { id: 'c2', name: 'Beta' }]
  const invoices = [
    { id: 'i1', date: '2026-09-01', status: 'approved', total: 300, client_id: 'c1' },
    { id: 'i2', date: '2026-09-02', status: 'paid', total: 500, client_id: 'c2' },
    { id: 'i3', date: '2026-09-03', status: 'draft', total: 9999, client_id: 'c2' },
    { id: 'i4', date: '2026-09-04', status: 'approved', total: 100, client_id: null },
  ]

  it('trie par CA décroissant, limite et gère le client supprimé', () => {
    const top = buildTopClientsSeries(invoices, clients, 1)
    assert.deepEqual(top, [{ id: 'c2', name: 'Beta', revenue: 500 }])

    const all = buildTopClientsSeries(invoices, [], 5)
    assert.equal(all[0].name, 'Client supprimé')
  })
})

describe('chartScaleMax / formatCompactFcfa', () => {
  it('arrondit la borne haute et gère le vide', () => {
    assert.equal(chartScaleMax([]), 1)
    assert.equal(chartScaleMax([0, 0]), 1)
    assert.equal(chartScaleMax([40]), 50)
    assert.equal(chartScaleMax([900]), 1000)
    assert.equal(chartScaleMax([9000]), 10000)
  })

  it('compacte les montants', () => {
    assert.equal(formatCompactFcfa(950), '950')
    assert.equal(formatCompactFcfa(1500), '2 k')
    assert.equal(formatCompactFcfa(2_400_000), '2.4 M')
  })
})

describe('géométrie SVG', () => {
  it('place les points d une courbe', () => {
    const points = lineChartPoints([0, 50, 100], 100, 100, 100, 0)
    assert.deepEqual(points.map(p => p.x), [0, 50, 100])
    assert.deepEqual(points.map(p => p.y), [100, 50, 0])
    assert.equal(toLinePath(points), 'M0,100 L50,50 L100,0')
    assert.match(toAreaPath(points, 100), /Z$/)
  })

  it('gère une série vide', () => {
    assert.deepEqual(lineChartPoints([], 100, 100, 10), [])
    assert.equal(toAreaPath([], 100), '')
  })

  it('calcule les rectangles de barres', () => {
    const rects = barRects([0, 50, 100], 60, 100, 100, 0)
    assert.equal(rects.length, 3)
    assert.equal(rects[2].height, 100)
    assert.equal(rects[2].y, 0)
    assert.equal(rects[0].height, 0)
    assert.equal(rects[1].x, 20)
  })

  it('gère les barres vides', () => {
    assert.deepEqual(barRects([], 60, 100, 100), [])
  })
})

describe('donutSegments / svgDashArray', () => {
  it('calcule les pourcentages et décalages cumulés', () => {
    const segments = donutSegments([
      { key: 'a', label: 'A', value: 50 },
      { key: 'b', label: 'B', value: 30 },
      { key: 'c', label: 'C', value: 20 },
    ])
    assert.equal(segments[0].percent, 0.5)
    assert.equal(segments[1].offset, 0.5)
    assert.equal(segments[2].offset, 0.8)
    assert.notEqual(segments[0].color, segments[1].color)
  })

  it('gère un total nul', () => {
    const segments = donutSegments([{ key: 'a', label: 'A', value: 0 }])
    assert.equal(segments[0].percent, 0)
    assert.equal(segments[0].offset, 0)
  })

  it('borne le dasharray', () => {
    assert.equal(svgDashArray(0.5, 100), '50 100')
    assert.equal(svgDashArray(2, 100), '100 100')
    assert.equal(svgDashArray(-1, 100), '0 100')
  })
})
