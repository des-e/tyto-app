import { invoke } from '@tauri-apps/api/core'
import { type SetStateAction, useContext, useEffect, useState } from 'react'
import type { AudioDevice } from '~/lib/audio'
import { CONFIG_KEYS } from '~/lib/config-keys'
import { usePersisted } from '~/lib/config-store'
import { KEEP_AWAKE, startKeepAwake, stopKeepAwake } from '~/lib/keep-awake'
import { ensureSystemAudioPermission } from '~/lib/permissions'
import { recordingsFolder } from '~/lib/tyto/media-path'
import {
	type CaptureTarget,
	onRecordingFailed,
	onRecordingFinished,
	onRecordingState,
	pauseRecording,
	type RecordingMode,
	resumeRecording,
	startRecording,
	stopRecording,
} from '~/lib/tyto/screen-recording'
import { ErrorModalContext } from '~/providers/error-modal'
import { usePreferenceProvider } from '~/providers/preference'

export function useRecording(onBeforeStart: () => void) {
	const preference = usePreferenceProvider()
	const { setState: setErrorModal } = useContext(ErrorModalContext)
	const [devices, setDevices] = useState<AudioDevice[]>([])
	const [savedInputDeviceId, setSavedInputDeviceId] = usePersisted<string | null>(CONFIG_KEYS.inputDeviceId, null)
	const [savedOutputDeviceId, setSavedOutputDeviceId] = usePersisted<string | null>(CONFIG_KEYS.outputDeviceId, null)
	const [inputDevice, setInputDevice] = useState<AudioDevice | null>(null)
	const [outputDevice, setOutputDevice] = useState<AudioDevice | null>(null)
	const [isRecording, setIsRecording] = useState(false)
	const [isPaused, setIsPaused] = useState(false)
	const [recordingName, setRecordingName] = useState('')

	function setInputDeviceAndSave(value: SetStateAction<AudioDevice | null>) {
		const device = typeof value === 'function' ? value(inputDevice) : value
		setSavedInputDeviceId(device?.id ?? '')
		setInputDevice(device)
	}

	function setOutputDeviceAndSave(value: SetStateAction<AudioDevice | null>) {
		const device = typeof value === 'function' ? value(outputDevice) : value
		setSavedOutputDeviceId(device?.id ?? '')
		setOutputDevice(device)
	}

	async function loadAudioDevices() {
		const newDevices = await invoke<AudioDevice[]>('get_audio_devices')
		const inputs = newDevices.filter((device) => device.isInput)
		const outputs = newDevices.filter((device) => !device.isInput)
		setInputDevice(
			savedInputDeviceId === null
				? (inputs.find((device) => device.isDefault) ?? null)
				: (inputs.find((device) => device.id === savedInputDeviceId) ?? null),
		)
		setOutputDevice(
			savedOutputDeviceId === null
				? (outputs.find((device) => device.isDefault) ?? null)
				: (outputs.find((device) => device.id === savedOutputDeviceId) ?? null),
		)
		setDevices(newDevices)
	}

	useEffect(() => {
		if (preference.homeTab === 'record') loadAudioDevices()
	}, [preference.homeTab])

	// The recorder is one per app: a recording started by the shortcut or the meeting prompt pauses here too.
	useEffect(() => {
		const end = () => {
			stopKeepAwake(KEEP_AWAKE.record)
			setIsPaused(false)
		}
		const unlisteners = [
			onRecordingState((state) => setIsPaused(state.status === 'paused')),
			onRecordingFinished(end),
			onRecordingFailed(end),
		]
		return () => {
			for (const unlisten of unlisteners) unlisten.then((dispose) => dispose())
		}
	}, [])

	async function startRecord(mode: RecordingMode = 'audio', target?: CaptureTarget) {
		if (outputDevice && !(await ensureSystemAudioPermission())) return
		startKeepAwake(KEEP_AWAKE.record)
		onBeforeStart()
		setIsRecording(true)
		setIsPaused(false)
		const selectedDevices = [inputDevice, outputDevice].filter((device): device is AudioDevice => device !== null)
		try {
			await startRecording({
				mode,
				target: target ?? null,
				devices: selectedDevices,
				recordingsDir: await recordingsFolder(preference.projectsPath),
				// The quality setting arrives with the video recording settings.
				quality: 'good',
				name: recordingName.trim() || null,
			})
		} catch (error) {
			stopKeepAwake(KEEP_AWAKE.record)
			setIsRecording(false)
			console.error('startRecord error: ', error)
			setErrorModal?.({ log: String(error), open: true })
		}
	}

	async function pauseRecord() {
		try {
			await pauseRecording()
		} catch (error) {
			console.error('pauseRecord error: ', error)
		}
	}

	async function resumeRecord() {
		try {
			await resumeRecording()
		} catch (error) {
			console.error('resumeRecord error: ', error)
		}
	}

	async function stopRecord() {
		try {
			await stopRecording()
		} catch (error) {
			stopKeepAwake(KEEP_AWAKE.record)
			setIsRecording(false)
			console.error('stopRecord error: ', error)
			setErrorModal?.({ log: String(error), open: true })
		}
	}

	return {
		devices,
		setDevices,
		inputDevice,
		outputDevice,
		isRecording,
		setIsRecording,
		isPaused,
		recordingName,
		setRecordingName,
		setInputDevice: setInputDeviceAndSave,
		setOutputDevice: setOutputDeviceAndSave,
		startRecord,
		pauseRecord,
		resumeRecord,
		stopRecord,
	}
}
