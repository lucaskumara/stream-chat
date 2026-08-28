import React from 'react'
import { createRoot } from 'react-dom/client'
import { StyleProvider } from '@ant-design/cssinjs'
import { App as AntApp, ConfigProvider } from 'antd'
import App from './App'
import { chatTheme } from './theme'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root missing from index.html')

createRoot(container).render(
  <React.StrictMode>
    <StyleProvider layer>
      <ConfigProvider theme={chatTheme}>
        <AntApp style={{ height: '100%' }}>
          <App />
        </AntApp>
      </ConfigProvider>
    </StyleProvider>
  </React.StrictMode>
)
