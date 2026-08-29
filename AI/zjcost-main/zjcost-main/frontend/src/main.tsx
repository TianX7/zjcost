import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/layout.css'
import './styles/dashboard.css'
import './styles/drawing.css'
import './styles/pricing.css'
import './styles/rules.css'
import './styles/pmc.css'
import './styles/lifecycle.css'
import './styles/ifc.css'
import './styles/pages.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
