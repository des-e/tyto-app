import { m } from '~/paraglide/messages.js'
import { splitSummary } from '~/lib/ai'

interface AiParts {
	summary?: string
	thread?: { question: string; answer: string }[]
}

/**
 * «ИИ-разбор» in the export dialog (Denis, 2026-11-04): everything the AI wrote for a recording as
 * one markdown text: the summary with its topics, the AI review, and questions asked with an own
 * key. The export writes it where it used to write the summary alone.
 */
export function aiExportText({ summary, thread = [] }: AiParts): string {
	const parts: string[] = []
	if (summary?.trim()) {
		const { text, topics } = splitSummary(summary)
		if (text) parts.push(`## ${m.summaryTab()}\n\n${text}`)
		if (topics.length) parts.push(`## ${m.topicsTab()}\n\n${topics.map((topic) => `- ${topic.start} ${topic.title}`).join('\n')}`)
	}
	const reviewTitle = m.tytoAiReview()
	// A review is saved under its own title as the "question"; the newest one counts.
	const review = [...thread].reverse().find((entry) => entry.question === reviewTitle)
	if (review?.answer.trim()) parts.push(`## ${reviewTitle}\n\n${review.answer.trim()}`)
	const questions = thread.filter((entry) => entry.question !== reviewTitle && entry.answer.trim())
	if (questions.length) {
		parts.push(`## ${m.askTranscript()}\n\n${questions.map((entry) => `**${entry.question.trim()}**\n\n${entry.answer.trim()}`).join('\n\n')}`)
	}
	return parts.join('\n\n')
}

/**
 * The same text for formats that are not markdown (PDF, Word, plain text, HTML, subtitles): headings
 * become their own lines and bold marks go, so no «##» or «**» shows in a printed document.
 */
export function plainAiText(markdown: string): string {
	return markdown
		.split('\n')
		.map((line) =>
			line
				.replace(/^#{1,6}\s+/, '')
				.replace(/\*\*(.+?)\*\*/g, '$1')
				.replace(/__(.+?)__/g, '$1'),
		)
		.join('\n')
}
