import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installChunkErrorHandler } from './lib/chunkReload.js'
import { installClarity } from './lib/clarity.js'
import { installMetaPixel } from './lib/metaPixel.js'
import { hasAnalyticsConsent, onConsentChange } from './lib/consent.js'

// Before render: a deploy that lands while someone has the site open leaves
// their tab asking for chunk filenames that no longer exist.
installChunkErrorHandler()

// Third-party analytics, and nothing else here, waits for a decision.
// Clarity records sessions — including what is typed into form fields — and
// it used to install before React rendered, while the Meta pixel fired from
// the document head. Both had transmitted before the visitor saw anything.
// Both are idempotent, so running this twice is harmless.
function startConsentedAnalytics() {
  installClarity()   // no-ops unless VITE_CLARITY_PROJECT_ID is set
  installMetaPixel()
}

if (hasAnalyticsConsent()) startConsentedAnalytics()
onConsentChange((state) => { if (state === 'granted') startConsentedAnalytics() })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
