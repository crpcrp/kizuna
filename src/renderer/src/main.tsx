import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import AppShell from './AppShell'

// Renderer entry: mount the React tree into #root.
const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Renderer bootstrap failed: #root element not found')
}

createRoot(rootEl).render(
  <StrictMode>
    <AppShell />
  </StrictMode>
)
