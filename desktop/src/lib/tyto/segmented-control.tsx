import type { ReactNode } from 'react'
import { cn } from '~/lib/style'

export interface SegmentedOption<T extends string> {
	value: T
	label: string
	icon?: ReactNode
}

/**
 * Tyto's segmented control: the selected segment is a solid foreground plate with inverted text
 * (`tyto-selected`, styled in theme.css), so it reads at a glance in both themes. Vibe's version was
 * a white segment on a near-white track, which disappeared in the light theme.
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
		<div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex rounded-[var(--tyto-r-md)] border border-border p-0.5', className)}>
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
							'flex h-8 cursor-pointer items-center justify-center gap-1 rounded-[var(--tyto-r-sm)] px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground focus-visible:outline-offset-2',
							selected ? 'tyto-selected' : 'text-muted-foreground hover:text-foreground',
						)}>
						{option.icon}
						{option.label}
					</button>
				)
			})}
		</div>
	)
}
