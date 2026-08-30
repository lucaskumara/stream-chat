import { describe, expect, it } from 'vitest'
import {
  clamp,
  contiguousOrder,
  marksFor,
  neighbourUnits,
  ownership,
  passedNeighbours,
  runsFor,
  spanOver,
  travelBounds,
  type Span
} from '@/components/tab-strip'

const TAB_WIDTH = 50

/** Tabs laid left to right, 50 wide with no gap, in the order given. */
function strip(ids: string[]): Map<string, Span> {
  return new Map(
    ids.map((id, at) => [id, { left: at * TAB_WIDTH, right: (at + 1) * TAB_WIDTH }])
  )
}

describe('ownership', () => {
  it('maps every member onto its group', () => {
    const owner = ownership([['a', 'b']])

    expect(owner.get('a')?.members).toEqual(['a', 'b'])
    expect(owner.get('b')?.members).toBe(owner.get('a')?.members)
    expect(owner.get('c')).toBeUndefined()
  })

  it('gives each group its own colour', () => {
    const owner = ownership([['a', 'b'], ['c', 'd']])

    expect(owner.get('a')?.color).not.toBe(owner.get('c')?.color)
  })

  it('colours by index rather than by hash, so two groups cannot collide', () => {
    const owner = ownership([['a'], ['b'], ['c'], ['d'], ['e'], ['f']])
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => owner.get(id)?.color))

    expect(colors.size).toBe(6)
  })

  it('cycles the palette once there are more groups than colours', () => {
    const groups = Array.from({ length: 7 }, (_, at) => [`g${at}`])
    const owner = ownership(groups)

    expect(owner.get('g6')?.color).toBe(owner.get('g0')?.color)
  })
})

describe('contiguousOrder', () => {
  it('leaves an order with no groups alone', () => {
    expect(contiguousOrder(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c'])
  })

  it('leaves a group that is already one unbroken run alone', () => {
    expect(contiguousOrder(['a', 'b', 'c'], [['a', 'b']])).toEqual(['a', 'b', 'c'])
  })

  // The single pass that buys both drag rules: a member dragged out of its run is
  // pulled back, and a foreign tab dropped inside a run is pushed out.
  it('pulls a stray member back to its run', () => {
    expect(contiguousOrder(['a', 'b', 'c', 'd'], [['a', 'c']])).toEqual([
      'a',
      'c',
      'b',
      'd'
    ])
  })

  it('pushes a foreign tab out of a run it landed inside', () => {
    expect(contiguousOrder(['x', 'a', 'y', 'b', 'z'], [['a', 'b']])).toEqual([
      'x',
      'a',
      'b',
      'y',
      'z'
    ])
  })

  it('seats the run where its first member sits', () => {
    expect(contiguousOrder(['x', 'b', 'y', 'a'], [['a', 'b']])).toEqual([
      'x',
      'b',
      'a',
      'y'
    ])
  })

  it('keeps two groups apart', () => {
    expect(contiguousOrder(['a', 'c', 'b', 'd'], [['a', 'b'], ['c', 'd']])).toEqual([
      'a',
      'b',
      'c',
      'd'
    ])
  })

  it('loses nothing and invents nothing', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const ordered = contiguousOrder(ids, [['b', 'd']])

    expect([...ordered].sort()).toEqual([...ids].sort())
  })
})

describe('runsFor', () => {
  it('gives every member of a group the same run', () => {
    const runs = runsFor(['a', 'b', 'c'], ownership([['a', 'b']]))

    expect(runs[0]).toEqual({ start: 0, end: 1 })
    expect(runs[1]).toEqual({ start: 0, end: 1 })
    expect(runs[2]).toBeNull()
  })

  it('gives an ungrouped strip no runs at all', () => {
    expect(runsFor(['a', 'b'], ownership([]))).toEqual([null, null])
  })

  it('spans a run of three', () => {
    const runs = runsFor(['a', 'b', 'c'], ownership([['a', 'b', 'c']]))

    expect(runs[1]).toEqual({ start: 0, end: 2 })
  })
})

describe('marksFor', () => {
  it('bands a run, marking only its ends', () => {
    const marks = marksFor(['a', 'b', 'c'], ownership([['a', 'b']]))

    expect(marks.get('a')?.className).toBe('tab-group tab-group-start')
    expect(marks.get('b')?.className).toBe('tab-group tab-group-end')
    expect(marks.get('c')).toBeUndefined()
  })

  it('marks a lone member as both ends of its own run', () => {
    const marks = marksFor(['a'], ownership([['a']]))

    expect(marks.get('a')?.className).toBe('tab-group tab-group-start tab-group-end')
  })

  it('leaves the middle of a run unmarked at either end', () => {
    const marks = marksFor(['a', 'b', 'c'], ownership([['a', 'b', 'c']]))

    expect(marks.get('b')?.className).toBe('tab-group')
  })

  // Only the leftmost member carries the grip that drags the whole block.
  it('flags the first member of a run as the start', () => {
    const marks = marksFor(['a', 'b'], ownership([['a', 'b']]))

    expect(marks.get('a')?.start).toBe(true)
    expect(marks.get('b')?.start).toBe(false)
  })

  it('gives both members of a run one colour', () => {
    const marks = marksFor(['a', 'b'], ownership([['a', 'b']]))

    expect(marks.get('a')?.color).toBe(marks.get('b')?.color)
  })
})

describe('spanOver', () => {
  it('reaches from the leftmost edge to the rightmost', () => {
    expect(spanOver(strip(['a', 'b', 'c']), ['a', 'c'])).toEqual({ left: 0, right: 150 })
  })

  it('measures a single tab', () => {
    expect(spanOver(strip(['a', 'b']), ['b'])).toEqual({ left: 50, right: 100 })
  })

  it('ignores an id it has no span for', () => {
    expect(spanOver(strip(['a']), ['a', 'ghost'])).toEqual({ left: 0, right: 50 })
  })

  it('answers null when it measured nothing', () => {
    expect(spanOver(strip(['a']), ['ghost'])).toBeNull()
    expect(spanOver(strip([]), [])).toBeNull()
  })
})

describe('travelBounds', () => {
  it('lets a tab reach either end of its limit and no further', () => {
    expect(travelBounds({ left: 50, right: 100 }, { left: 0, right: 150 })).toEqual({
      min: -50,
      max: 50
    })
  })

  it('pins a span that already fills its limit', () => {
    expect(travelBounds({ left: 0, right: 100 }, { left: 0, right: 100 })).toEqual({
      min: 0,
      max: 0
    })
  })

  // A group's clamp measures the block, not the grabbed tab, or the group gains a
  // tab's worth of slack for every extra member.
  it('measures the whole block, so a group gains no extra slack', () => {
    const spans = strip(['a', 'b', 'c'])
    const block = spanOver(spans, ['a', 'b'])
    const strip3 = spanOver(spans, spans.keys())

    expect(travelBounds(block as Span, strip3 as Span)).toEqual({ min: 0, max: 50 })
  })
})

describe('clamp', () => {
  it('holds a value inside its limits', () => {
    const limit = { min: -50, max: 50 }

    expect(clamp(0, limit)).toBe(0)
    expect(clamp(999, limit)).toBe(50)
    expect(clamp(-999, limit)).toBe(-50)
  })

  it('leaves the value alone when there is no limit', () => {
    expect(clamp(999, null)).toBe(999)
  })
})

describe('neighbourUnits', () => {
  it('treats each ungrouped tab as its own unit', () => {
    const units = neighbourUnits(['a', 'b'], strip(['a', 'b']), ownership([]), [])

    expect(units).toEqual([
      { ids: ['a'], left: 0, width: 50 },
      { ids: ['b'], left: 50, width: 50 }
    ])
  })

  // A whole run steps aside at once; walking individual tabs makes the group being
  // dragged over come apart.
  it('merges a run into one unit that moves together', () => {
    const units = neighbourUnits(
      ['a', 'b', 'c'],
      strip(['a', 'b', 'c']),
      ownership([['b', 'c']]),
      []
    )

    expect(units).toEqual([
      { ids: ['a'], left: 0, width: 50 },
      { ids: ['b', 'c'], left: 50, width: 100 }
    ])
  })

  it('leaves out whatever is being carried', () => {
    const units = neighbourUnits(
      ['a', 'b', 'c'],
      strip(['a', 'b', 'c']),
      ownership([['a', 'b']]),
      ['a', 'b']
    )

    expect(units).toEqual([{ ids: ['c'], left: 100, width: 50 }])
  })

  it('does not merge two separate groups into one unit', () => {
    const units = neighbourUnits(
      ['a', 'b'],
      strip(['a', 'b']),
      ownership([['a'], ['b']]),
      []
    )

    expect(units).toHaveLength(2)
  })
})

describe('passedNeighbours', () => {
  const block = { left: 100, width: 50, rest: [] }
  const rest = [
    { ids: ['a'], left: 0, width: 50 },
    { ids: ['c'], left: 150, width: 50 },
    { ids: ['d'], left: 200, width: 50 }
  ]

  it('passes nothing when the block has not moved', () => {
    expect(passedNeighbours({ ...block, rest }, 0)).toEqual([])
  })

  it('passes nothing without a block', () => {
    expect(passedNeighbours(null, 100)).toEqual([])
  })

  it('sweeps past a neighbour once it is more than half crossed', () => {
    expect(passedNeighbours({ ...block, rest }, 60).map((unit) => unit.ids)).toEqual([
      ['c']
    ])
  })

  it('has not passed a neighbour it is only half way across', () => {
    expect(passedNeighbours({ ...block, rest }, 20)).toEqual([])
  })

  it('sweeps past two neighbours at full travel', () => {
    expect(passedNeighbours({ ...block, rest }, 200).map((unit) => unit.ids)).toEqual([
      ['c'],
      ['d']
    ])
  })

  it('looks left when the block is dragged left', () => {
    expect(passedNeighbours({ ...block, rest }, -60).map((unit) => unit.ids)).toEqual([
      ['a']
    ])
  })

  // A run is swept as one wide unit, so it takes half of the whole run to cross —
  // not half of its first tab. Otherwise the group being dragged over comes apart.
  it('counts a merged run as one wide neighbour, not as its members', () => {
    const run = [{ ids: ['c', 'd'], left: 150, width: 100 }]
    const single = [{ ids: ['c'], left: 150, width: 50 }]

    expect(passedNeighbours({ ...block, rest: run }, 40)).toEqual([])
    expect(passedNeighbours({ ...block, rest: single }, 40).map((unit) => unit.ids)).toEqual(
      [['c']]
    )

    expect(passedNeighbours({ ...block, rest: run }, 60).map((unit) => unit.ids)).toEqual([
      ['c', 'd']
    ])
  })
})
