import type { ReactNode } from 'react'
import { cn } from '~/lib/style'

export interface SegmentedOption<T extends string> {
	value: T
	label: string
	icon?: ReactNode
}

/**
 * Tyto's segmented control: a white segment with a hairline ring on a grey track (`.tyto-segmented`
 * in theme.css, design round 5). The ring keeps the selected segment visible in the light theme.
 */
export function SegmentedControl<T extends string>({
	value,
	options,
	onChange,
	ariaLabel,
	className,
}: {
	value: T
	options: SegmentedOption<T>[]
	onChange: (value: T) => void
	ariaLabel: string
	className?: string
}) {
	return (
		<div role="radiogroup" aria-label={ariaLabel} className={cn('tyto-segmented inline-flex gap-0.5 rounded-[var(--tyto-r-md)] p-0.5', className)}>
			{options.map((option) => {
				const selected = option.value === value
				return (
					<button
						key={option.value}
						type="button"
						role="radio"
						aria-checked={selected}
						aria-label={option.label}
						title={option.label}
						data-selected={selected}
						onClick={() => onChange(option.value)}
						className={cn(
							'flex h-7 cursor-pointer items-center justify-center gap-1 rounded-[var(--tyto-r-sm)] px-3 text-[12.5px] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground focus-visible:outline-offset-2',
							selected ? 'font-medium' : 'text-muted-foreground hover:text-foreground',
						)}>
						{option.icon}
						{option.label}
					</button>
				)
			})}
		</div>
	)
}
