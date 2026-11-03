import { invoke } from '@tauri-apps/api/core'

export type MeetingSource = 'meet' | 'zoom' | 'teams' | 'telemost' | 'bitrix24' | 'browser'

export interface MeetingPromptState {
	source: MeetingSource
}

export interface MeetingRecordingOptions {
	microphone: boolean
	systemAudio: boolean
	/** «С видео» in the meeting prompt records the call's window too. */
	mode?: 'audio' | 'video'
	/** The call the prompt reported: its window is the one recorded with video. */
	source?: MeetingSource
}

export const getMeetingDetectionEnabled = () => invoke<boolean>('get_meeting_detection_enabled')

export const setMeetingDetectionEnabled = (enabled: boolean) => invoke<void>('set_meeting_detection_enabled', { enabled })

export const getMeetingPromptState = () => invoke<MeetingPromptState | null>('get_meeting_prompt_state')

export const dismissMeetingPrompt = () => invoke<void>('dismiss_meeting_prompt')

export const meetingPromptReady = () => invoke<void>('meeting_prompt_ready')
