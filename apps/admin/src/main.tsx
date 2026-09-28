import '@fontsource-variable/cairo'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import './i18n'
import App from './App'
import { requestPersistentStorage } from './lib/device'
import { auth } from './auth'

void requestPersistentStorage()
void auth.start()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
