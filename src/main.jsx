import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installChunkErrorHandler } from './lib/chunkReload.js'

// Before render: a deploy that lands while someone has the site open leaves
// their tab asking for chunk filenames that no longer exist.
installChunkErrorHandler()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
