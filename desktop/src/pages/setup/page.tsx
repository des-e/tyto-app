import { viewModel } from './view-model'
import { SetupSteps } from '~/lib/tyto/setup-steps'

function App() {
	const vm = viewModel()
	return <SetupSteps vm={vm} />
}

export default App
