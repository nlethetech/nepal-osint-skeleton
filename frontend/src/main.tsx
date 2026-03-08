import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { HotkeysProvider } from '@blueprintjs/core'
import { queryClient } from './lib/queryClient'
import App from './App'

// Blueprint CSS (must come before app styles so Tailwind can override if needed)
import "normalize.css"
import "@blueprintjs/core/lib/css/blueprint.css"
import "@blueprintjs/icons/lib/css/blueprint-icons.css"
import "@blueprintjs/table/lib/css/table.css"

// App styles (Tailwind + custom)
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HotkeysProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </HotkeysProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
