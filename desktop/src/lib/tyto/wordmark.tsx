import type { SVGProps } from 'react'
import { useFinishBlinks } from './owl-mark'

type BlinkJob = { id: string; status: string }

/**
 * The Tyto wordmark 8c «Тихий, легче целиком», small cut (design/tyto/logo/lockup-small.svg): owl and
 * letters outlined in one drawing, heavier ring for ~20 px caps. Everything is `currentColor`, so it
 * follows the theme. The viewBox starts 114 units above the baseline and the owl's ears rise above the
 * cap line, so size it by height (`h-[26px] w-auto`) and let the row align the box, not the ink.
 *
 * `blink` adds the eyelids (theme.css `.tyto-owl-lid`) over the owl's eyes; remount (`key`) to repeat.
 */
export function Wordmark({ blink = false, ...props }: SVGProps<SVGSVGElement> & { blink?: boolean }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 -114 396.81 142.61"
			fill="currentColor"
			role="img"
			aria-label="Tyto"
			data-testid="wordmark"
			{...props}>
			<title>Tyto</title>
			<g transform="translate(-57.35 -158.47) scale(0.21)">
				<path
					fillRule="evenodd"
					d="M276 214L396 296Q512 336 628 296L748 214L748 620C748 750 640 830 512 830C384 830 276 750 276 620ZM322 448A92 92 0 1 0 506 448A92 92 0 1 0 322 448ZM518 448A92 92 0 1 0 702 448A92 92 0 1 0 518 448ZM480 556L512 612L544 556Z"
				/>
				<path d="M362 448A52 52 0 1 1 466 448A52 52 0 1 1 362 448ZM558 448A52 52 0 1 1 662 448A52 52 0 1 1 558 448Z" />
				{blink && (
					<>
						<circle className="tyto-owl-lid" cx="414" cy="448" r="92" />
						<circle className="tyto-owl-lid" cx="610" cy="448" r="92" />
					</>
				)}
			</g>
			<g transform="translate(132.08 0) scale(1)">
				<path d="M4.40 -109.00L25.94 -100.00Q44.29 -97.00 62.63 -100.00L84.17 -109.00V-83.98H4.40Z" />
				<path d="M36.27 -85.98H52.3V0H36.27Z" />
				<path d="M94.54 0.7 65.3 -68.61H82.89L102.8 -17.53H97.62L118.63 -68.61H136.36L104.61 0.7ZM74.24 28.61 95.51 -15.31 104.61 0.7 91.92 28.61Z" />
				<path d="M158.76 0V-97.19H174.78V0ZM142.36 -54.11V-68.61H191.17V-54.11Z" />
				<path
					fillRule="evenodd"
					d="M192.67 -34.31A36.03 36.03 0 1 1 264.73 -34.31A36.03 36.03 0 1 1 192.67 -34.31ZM207.41 -34.31A21.29 21.29 0 1 0 249.99 -34.31A21.29 21.29 0 1 0 207.41 -34.31Z"
				/>
				<path d="M220.19 -34.31A8.52 8.52 0 1 1 237.22 -34.31A8.52 8.52 0 1 1 220.19 -34.31Z" />
			</g>
		</svg>
	)
}

/** The sidebar brand: the wordmark whose owl blinks once each time a transcription finishes. */
export function FinishBlinkWordmark({ jobs, ...props }: SVGProps<SVGSVGElement> & { jobs: BlinkJob[] }) {
	const blinks = useFinishBlinks(jobs)
	return <Wordmark key={blinks} blink={blinks > 0} {...props} />
}
