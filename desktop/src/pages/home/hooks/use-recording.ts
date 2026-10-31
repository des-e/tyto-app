import { invoke } from '@tauri-apps/api/core'
import { type SetStateAction, useContext, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
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
	type RecorderStatus,
} from '~/lib/tyto/screen-recording'
import { m } from '~/paraglide/messages.js'
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
	const [status, setStatus] = useState<RecorderStatus>('idle')
	const statusRef = useRef<RecorderStatus>('idle')
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

	function updateStatus(next: RecorderStatus) {
		statusRef.current = next
		setStatus(next)
	}

	// The recorder is one per app: a recording started by the shortcut or the meeting prompt pauses here too.
	useEffect(() => {
		const end = () => {
			stopKeepAwake(KEEP_AWAKE.record)
			updateStatus('idle')
		}
		const unlisteners = [onRecordingState((state) => updateStatus(state.status)), onRecordingFinished(end), onRecordingFailed(end)]
		return () => {
			for (const unlisten of unlisteners) unlisten.then((dispose) => dispose())
		}
	}, [])

	async function startRecord(mode: RecordingMode = 'audio', target?: CaptureTarget) {
		if (statusRef.current !== 'idle') return
		if (outputDevice && !(await ensureSystemAudioPermission())) return
		startKeepAwake(KEEP_AWAKE.record)
		onBeforeStart()
		setIsRecording(true)
		updateStatus('recording')
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
			updateStatus('idle')
			console.error('startRecord error: ', error)
			setErrorModal?.({ log: String(error), open: true })
		}
	}

	async function pauseRecord() {
		if (statusRef.current !== 'recording') return
		try {
			await pauseRecording()
		} catch (error) {
			console.error('pauseRecord error: ', error)
			toast.error(m.error(), { description: String(error), position: 'bottom-center' })
		}
	}

	async function resumeRecord() {
		if (statusRef.current !== 'paused') return
		try {
			await resumeRecording()
		} catch (error) {
			console.error('resumeRecord error: ', error)
			toast.error(m.error(), { description: String(error), position: 'bottom-center' })
		}
	}

	/** A stop while the recording is being saved does nothing: the result is on its way. */
	async function stopRecord() {
		if (statusRef.current === 'finishing') return
		try {
			await stopRecording()
		} catch (error) {
			console.error('stopRecord error: ', error)
			toast.error(m.error(), { description: String(error), position: 'bottom-center' })
		}
	}

	return {
		devices,
		setDevices,
		inputDevice,
		outputDevice,
		isRecording,
		setIsRecording,
		status,
		isPaused: status === 'paused',
		isFinishing: status === 'finishing',
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
