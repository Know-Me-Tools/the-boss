// IMPORTANT: Import bootstrapLogger first to ensure logger is initialized before any module that uses it
import './bootstrapLogger'
import './assets/styles/index.css'
import './assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'

import { createRoot } from 'react-dom/client'

import App from './App'

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<App />)
