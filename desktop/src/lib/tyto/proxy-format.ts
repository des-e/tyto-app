/**
 * Proxy services (resellers of model tokens) give one address in two forms: `https://<service>/v1`
 * for the OpenAI format and the same address without `/v1` for the Claude (Anthropic) format.
 * So the address alone tells which request format the person pasted.
 */
export type ProxyFormat = 'openai' | 'claude'

export function detectProxyFormat(baseUrl: string): ProxyFormat {
	return /\/v1\/*$/i.test(baseUrl.trim()) ? 'openai' : 'claude'
}

/** `base` + `path` with exactly one slash between them, whatever either side ends or starts with. */
export function joinApiUrl(base: string, path: string): string {
	return `${base.trim().replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

/** Plain `http://` to anything but this computer: the key would travel unencrypted. */
export function isInsecureRemote(baseUrl: string): boolean {
	const match = /^http:\/\/(\[[^\]]*\]|[^/:?#]*)/i.exec(baseUrl.trim())
	if (!match) return false
	const host = match[1].toLowerCase()
	return host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]'
}
