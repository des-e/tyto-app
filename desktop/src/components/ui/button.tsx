import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '~/lib/style'

/*
 * Tyto button system (docs/design/2026-10-25-tyto-visual-language.md, «Система кнопок»).
 * New names: primary / secondary / ghost / destructive, sizes sm / md (+ lg for the first-run and empty
 * screens), `iconOnly` for square icon buttons. Vibe's names stay valid so upstream call sites keep
 * working: default → primary, outline → secondary, size default → md, icon → md + iconOnly (32 px),
 * iconSm → sm + iconOnly (28 px). Each variant carries a `tyto-btn-<variant>` marker class.
 */

const primary =
	'tyto-btn-primary bg-primary text-primary-foreground hover:bg-[color-mix(in_srgb,var(--primary)_84%,var(--background))]'
const secondary = 'tyto-btn-secondary border border-[var(--tyto-line2)] bg-background text-foreground hover:border-[var(--muted-foreground)] hover:bg-accent'
// Disabled fill: an explicit grey plate instead of Vibe's opacity-50 (a half-transparent black button reads as pressed).
const filledDisabled = 'disabled:border disabled:border-border disabled:bg-muted'

const buttonVariants = cva(
	'inline-flex items-center justify-center whitespace-nowrap font-medium cursor-pointer transition-transform duration-150 ease-[var(--tyto-ease)] [&:active:not(:focus-visible)]:scale-[.97] motion-reduce:transition-none motion-reduce:[&:active:not(:focus-visible)]:scale-100 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:text-[var(--tyto-disabled-fg)] disabled:shadow-none disabled:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
	{
		variants: {
			variant: {
				primary: cn(primary, filledDisabled),
				secondary: cn(secondary, filledDisabled),
				ghost: 'tyto-btn-ghost text-foreground hover:bg-accent disabled:hover:bg-transparent',
				destructive: cn('tyto-btn-destructive bg-[var(--tyto-danger)] text-white hover:bg-[color-mix(in_srgb,var(--tyto-danger)_88%,black)]', filledDisabled),
				link: 'tyto-btn-link text-foreground underline-offset-4 hover:underline',
				// Vibe names.
				default: cn(primary, filledDisabled),
				outline: cn(secondary, filledDisabled),
			},
			size: {
				sm: 'h-7 gap-1 rounded-[var(--tyto-r-sm)] px-3 text-[13px]',
				md: 'h-9 gap-2 rounded-[var(--tyto-r-md)] px-4 text-sm',
				lg: 'h-11 gap-2 rounded-[var(--tyto-r-md)] px-5 text-[15px]',
				// Vibe names.
				default: 'h-9 gap-2 rounded-[var(--tyto-r-md)] px-4 text-sm',
				icon: 'h-8 w-8 gap-2 rounded-[var(--tyto-r-md)] px-0 text-sm',
				iconSm: 'h-7 w-7 gap-1 rounded-[var(--tyto-r-sm)] px-0 text-[13px]',
			},
			iconOnly: {
				true: 'px-0',
				false: '',
			},
		},
		compoundVariants: [
			{ iconOnly: true, size: 'sm', class: 'w-7' },
			{ iconOnly: true, size: ['md', 'default'], class: 'h-8 w-8' },
			{ iconOnly: true, size: 'lg', class: 'w-11' },
			// Quiet icon buttons: muted glyph, grey plate and text colour on hover.
			{ variant: 'ghost', iconOnly: true, class: 'text-muted-foreground hover:text-foreground' },
			{ variant: 'ghost', size: ['icon', 'iconSm'], class: 'text-muted-foreground hover:text-foreground' },
		],
		defaultVariants: {
			variant: 'primary',
			size: 'md',
			iconOnly: false,
		},
	},
)

type BaseButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
	Omit<VariantProps<typeof buttonVariants>, 'iconOnly'> & {
		asChild?: boolean
	}

/** An icon-only button has no visible text, so it must name itself. */
export type ButtonProps = BaseButtonProps & ({ iconOnly: true; 'aria-label': string } | { iconOnly?: false })

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, iconOnly = false, asChild = false, ...props }, ref) => {
	if (iconOnly && !props['aria-label'] && !props['aria-labelledby'] && import.meta.env.DEV) {
		console.error('Button: iconOnly requires an aria-label (and a tooltip) so the action is named.')
	}
	const Comp = asChild ? Slot : 'button'
	return <Comp className={cn(buttonVariants({ variant, size, iconOnly, className }))} ref={ref} {...props} />
})
Button.displayName = 'Button'

export { Button, buttonVariants }
