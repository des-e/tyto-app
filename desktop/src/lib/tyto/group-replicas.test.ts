import { describe, expect, it } from 'vitest'
import type { Segment } from '~/lib/transcript'
import { groupReplicas, seriesStarts } from './group-replicas'

const seg = (start: number, speaker?: number): Segment => ({ start, stop: start + 10, text: `t${start}`, speaker })

describe('groupReplicas', () => {
	it('[1,1,2,1] → три серии', () => {
		const segments = [seg(0, 1), seg(10, 1), seg(20, 2), seg(30, 1)]
		const series = groupReplicas(segments)
		expect(series.map((s) => s.speaker)).toEqual([1, 2, 1])
		expect(series.map((s) => s.segments.length)).toEqual([2, 1, 1])
		expect(series[0].segments).toEqual([segments[0], segments[1]])
	})

	it('без диаризации (null-говорящие) одна серия', () => {
		const series = groupReplicas([seg(0), seg(10), seg(20)])
		expect(series).toHaveLength(1)
		expect(series[0].speaker).toBeNull()
		expect(series[0].segments).toHaveLength(3)
	})

	it('пустой список → нет серий', () => {
		expect(groupReplicas([])).toEqual([])
	})

	it('seriesStarts отмечает первую реплику каждой серии', () => {
		expect(seriesStarts([seg(0, 1), seg(10, 1), seg(20, 2), seg(30, 1)])).toEqual([true, false, true, true])
		expect(seriesStarts([seg(0), seg(10)])).toEqual([true, false])
	})
})
