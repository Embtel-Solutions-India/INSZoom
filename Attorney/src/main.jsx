import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import api from './services/api'
import { startBranding } from './utils/branding'

// Same firm brand colour (Settings -> Firm Profile) as Admin, so the portals match in light and dark mode.
startBranding(api.defaults.baseURL)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
