import { Check, Download, FolderOpen } from 'lucide-react'
import { m } from '~/paraglide/messages.js'
import NumberField from '~/components/number-field'
import { Input } from '~/components/ui/input'
import { Button } from '~/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { IconAction, SettingsGroup, SettingsRow, rowControlClass, type SettingsViewModel } from './shared'
import { getFriendlyModelName } from '~/lib/model'
import { MODEL_CATALOG, fileName } from '~/lib/tyto/model-catalog'
import { SegmentedControl } from '~/lib/tyto/segmented-control'

export function ModelsSection({ vm }: { vm: SettingsViewModel }) {
	const installed = vm.models
	const byFile = new Map(installed.map((model) => [fileName(model.path), model]))
	const catalogFiles = new Set(MODEL_CATALOG.map((entry) => entry.file))
	// Models the catalog does not know (pasted links, the Hebrew one, older downloads) are listed too.
	const others = installed.filter((model) => !catalogFiles.has(fileName(model.path)))

	function modelRow({ key, name, info, path, url }: { key: string; name: string; info: string; path?: string; url?: string }) {
		const selected = Boolean(path) && path === vm.preference.modelPath
		return (
			<SettingsRow key={key} label={name} description={info}>
				{selected ? (
					<span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
						<Check aria-hidden className="h-3.5 w-3.5" />
						{m.modSelected()}
					</span>
				) : path ? (
					<Button variant="outline" size="sm" onClick={() => vm.selectModel(path)}>
						{m.modSelect()}
					</Button>
				) : url ? (
					<Button variant="outline" size="sm" onClick={() => vm.downloadCatalogModel(url)}>
						<Download aria-hidden className="h-3.5 w-3.5" />
						{m.modDownload()}
					</Button>
				) : null}
			</SettingsRow>
		)
	}

	return (
		<div className="space-y-6">
			<SettingsGroup title={m.modRecognition()}>
				{MODEL_CATALOG.map((entry) => (
					modelRow({ key: entry.file, name: entry.name, info: entry.info(), path: byFile.get(entry.file)?.path, url: entry.url })
				))}
				{others.map((model) => (
					modelRow({ key: model.path, name: vm.preference.modelDisplayNames[model.path] ?? getFriendlyModelName(model.name), info: m.modOwnModel(), path: model.path })
				))}
			</SettingsGroup>

			<SettingsGroup title={m.modComputer()}>
				<SettingsRow label={m.modEngine()} description={m.modEngineInfo()}>
					<SegmentedControl
						ariaLabel={m.modEngine()}
						value={vm.preference.noGpu ? 'cpu' : 'gpu'}
						onChange={(value) => vm.preference.setNoGpu(value === 'cpu')}
						options={[
							{ value: 'gpu', label: m.modGpu() },
							{ value: 'cpu', label: m.modCpu() },
						]}
					/>
				</SettingsRow>
				{!vm.isMacOS && !vm.preference.noGpu && (
					<SettingsRow label={m.gpuDevice()}>
						{vm.gpuDevices.length > 0 ? (
							<Select
								value={vm.preference.gpuDevice != null ? String(vm.preference.gpuDevice) : 'auto'}
								onValueChange={(value) => {
									vm.preference.setGpuDevice(value === 'auto' ? null : parseInt(value, 10))
								}}>
								<SelectTrigger className={`w-56 ${rowControlClass}`}>
									<SelectValue placeholder={m.gpuDevice()} />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">{m.auto()}</SelectItem>
									{vm.gpuDevices.map((device) => (
										<SelectItem key={device.index} value={String(device.index)}>
											{device.description}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						) : (
							<NumberField
								aria-label={m.gpuDevice()}
								value={vm.preference.gpuDevice ?? -1}
								min={-1}
								max={16}
								// Below zero means "no device pinned" — the placeholder the empty field used to show.
								format={(device) => (device < 0 ? m.auto() : undefined)}
								onChange={(value) => vm.preference.setGpuDevice(value < 0 ? null : value)}
							/>
						)}
					</SettingsRow>
				)}
			</SettingsGroup>

			{vm.corruptModels.length > 0 && (
				<SettingsGroup title={m.modelFileCorrupt()}>
					{vm.corruptModels.map((model) => (
						<SettingsRow
							key={model.path}
							label={getFriendlyModelName(model.name)}
							description={m.modelFileCorruptDescription({ name: model.name })}>
							<IconAction label={m.reDownload()} icon={<Download className="h-4 w-4" />} onClick={() => vm.redownloadModel(model)} />
							<IconAction label={m.showInFolder()} icon={<FolderOpen className="h-4 w-4" />} onClick={() => vm.openSelectedModel(model.path)} />
						</SettingsRow>
					))}
				</SettingsGroup>
			)}

			<SettingsGroup>
				<SettingsRow label={m.modFolder()}>
					<Button variant="ghost" size="sm" onClick={vm.openModelPath}>
						{m.modOpen()}
					</Button>
					<Button variant="outline" size="sm" onClick={vm.changeModelsFolder}>
						{m.modChange()}
					</Button>
				</SettingsRow>
				<SettingsRow label={m.modByLink()} description={m.modByLinkInfo()}>
					<Input
						type="text"
						value={vm.downloadURL}
						onChange={(event) => vm.setDownloadURL(event.target.value)}
						placeholder={m.modPasteLink()}
						aria-label={m.modByLink()}
						onKeyDown={(event) => (event.key === 'Enter' ? vm.downloadModel() : null)}
						className={`w-56 ${rowControlClass}`}
					/>
					<IconAction label={m.downloadModel()} icon={<Download className="h-4 w-4" />} onClick={vm.downloadModel} disabled={!vm.downloadURL} />
				</SettingsRow>
			</SettingsGroup>
		</div>
	)
}
