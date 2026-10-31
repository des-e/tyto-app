import { motion, useReducedMotion } from 'framer-motion'
import { Play } from 'lucide-react'
import type { ReactNode } from 'react'
import { m } from '~/paraglide/messages.js'

interface ScriptLineProps {
	/** index inside `job.segments`, published as `data-segment-index` */
	index: number
	/** formatted start time, «01:32» */
	time: string
	showTime: boolean
	/** the line being spoken right now */
	active: boolean
	/** first line of a speaker's series: carries the name and the larger gap above */
	seriesStart: boolean
	/** first rendered line: no gap above it */
	first: boolean
	animate: boolean
	onSeek: () => void
	/** speaker label shown above the first line of a series */
	header?: ReactNode
	/** speaker control for a line inside a series: appears on hover, takes no space */
	aside?: ReactNode
	/** the line's text, or its editor */
	children: ReactNode
}

/**
 * One transcript line laid out as a script (theme.css `.tyto-script-*`): the time sits in a 64 px
 * gutter and turns into «▶ 01:32» on hover, the name appears once per series, the current line gets
 * a 2 px rule at its start edge. No grey plates.
 */
export function ScriptLine({ index, time, showTime, active, seriesStart, first, animate, onSeek, header, aside, children }: ScriptLineProps) {
	const reduceMotion = useReducedMotion()
	return (
		<motion.div
			data-segment-index={index}
			data-series-start={seriesStart}
			data-active={active}
			initial={animate && !reduceMotion ? { opacity: 0, y: 4 } : false}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.15, ease: 'easeOut' }}
			className="tyto-script-line group"
			data-gap={seriesStart && !first ? 'speaker' : undefined}>
			<div className="tyto-script-gutter">
				<button type="button" onClick={onSeek} aria-label={m.playFromTime({ time })} className="tyto-script-time">
					<Play aria-hidden className="tyto-script-play" />
					{showTime && <span>{time}</span>}
				</button>
			</div>
			<div className="tyto-script-body">
				{header && <div className="tyto-script-who">{header}</div>}
				<div className="tyto-script-text">{children}</div>
			</div>
			{aside && <div className="tyto-script-aside">{aside}</div>}
		</motion.div>
	)
}
