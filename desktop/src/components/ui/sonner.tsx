import { Toaster as Sonner } from 'sonner'
import { getTextDirection } from '~/paraglide/runtime.js'

type ToasterProps = React.ComponentProps<typeof Sonner>

// Tyto: bottom centre of the main area, lifted above the player bar so the toast never covers the
// last line of the transcript. The plate itself (inverted, one line, action as bold text) is in theme.css.
const Toaster = ({ position = 'bottom-center', offset = { bottom: 'calc(var(--tyto-bar-h) + 12px)' }, ...props }: ToasterProps) => {
	return (
		<Sonner
			dir={getTextDirection()}
			theme="system"
			className="toaster group"
			position={position}
			offset={offset}
			toastOptions={{
				classNames: {
					toast: 'group toast',
					title: 'text-[13px] font-medium',
					description: 'text-[13px]',
				},
			}}
			{...props}
		/>
	)
}

export { Toaster }
