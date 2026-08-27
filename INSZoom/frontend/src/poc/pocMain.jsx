// pocMain.jsx — entry point for poc.html ONLY. Not referenced by
// src/main.jsx or App.jsx. See poc.html and PocHarness.jsx.
import ReactDOM from 'react-dom/client'
import PocHarness from './PocHarness.jsx'
import '../index.css'

ReactDOM.createRoot(document.getElementById('root')).render(<PocHarness />)
