import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installChunkErrorHandler } from './lib/chunkReload.js'
import { installClarity } from './lib/clarity.js'

// Before render: a deploy that lands while someone has the site open leaves
// their tab asking for chunk filenames that no longer exist.
installChunkErrorHandler()

// No-ops unless VITE_CLARITY_PROJECT_ID is set.
installClarity()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
