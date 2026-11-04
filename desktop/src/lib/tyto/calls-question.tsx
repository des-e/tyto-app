import { m } from '~/paraglide/messages.js'
import { Button } from '~/components/ui/button'
import { CONFIG_KEYS } from '~/lib/config-keys'
import { usePersisted } from '~/lib/config-store'
import { usePreferenceProvider } from '~/providers/preference'

/**
 * «Предлагать запись, когда начинается звонок?» on the main screen, asked once after the models are
 * in (design round 6). Detection is off by default, and after a reinstall it «did not work» on a
 * Mac only because nobody had turned it on. Either answer is remembered; settings can change it later.
 */
export function CallsQuestion() {
	const preference = usePreferenceProvider()
	const [asked, setAsked] = usePersisted<boolean>(CONFIG_KEYS.callsQuestionAsked, false)

	if (asked || preference.meetingDetectionEnabled || !preference.modelPath) return null

	function answer(yes: boolean) {
		if (yes) preference.setMeetingDetectionEnabled(true)
		setAsked(true)
	}

	return (
		<section aria-labelledby="tyto-calls-question" className="tyto-pending-row">
			<div className="min-w-[200px] flex-1 text-start">
				<h2 id="tyto-calls-question" className="text-[14px] font-medium text-foreground">
					{m.callsAskTitle()}
				</h2>
				<p className="mt-0.5 text-[12.5px] text-muted-foreground">{m.callsAskInfo()}</p>
			</div>
			<Button size="sm" onClick={() => answer(true)}>
				{m.callsAskYes()}
			</Button>
			<Button variant="ghost" size="sm" onClick={() => answer(false)}>
				{m.callsAskNo()}
			</Button>
		</section>
	)
}
