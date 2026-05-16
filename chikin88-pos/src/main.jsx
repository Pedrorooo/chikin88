import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 2500,
          style: {
            background: '#1A1A1A',
            color: '#fff',
            border: '1px solid #383838',
            fontWeight: 600,
            fontFamily: 'Plus Jakarta Sans, sans-serif',
          },
          success: { iconTheme: { primary: '#F4D35E', secondary: '#0A0A0A' } },
          error:   { iconTheme: { primary: '#D62828', secondary: '#fff' } },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>,
)
