import { loggerService } from '@logger'
import { createRoot } from 'react-dom/client'

import ArtifactPreviewApp from './ArtifactPreviewApp'

loggerService.initWindowSource('ArtifactPreview')

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<ArtifactPreviewApp />)
