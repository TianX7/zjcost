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

// 打包版：关闭浏览器窗口时通知后端优雅退出；刷新页面时取消待执行的退出。
// --app 模式下 Edge 启动器进程会立即退出（被判定为 delegated），主进程无法
// 感知窗口关闭，因此由前端在 pagehide 时显式上报。
const WINDOW_CLOSE_KEY = 'zjcost:window-closing'
const WINDOW_CLOSE_URL = '/api/_internal/window/close'
const WINDOW_CANCEL_URL = '/api/_internal/window/cancel-close'

function notifyWindowClose(close: boolean) {
  const url = close ? WINDOW_CLOSE_URL : WINDOW_CANCEL_URL
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, '')
    } else {
      fetch(url, { method: 'POST', keepalive: true }).catch(() => {})
    }
  } catch {
    /* 忽略：页面卸载阶段发送失败不影响主逻辑 */
  }
}

window.addEventListener('pagehide', () => {
  try {
    sessionStorage.setItem(WINDOW_CLOSE_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
  notifyWindowClose(true)
})

window.addEventListener('pageshow', (event) => {
  // bfcache 恢复（persisted）不是重新加载，不视为取消窗口关闭
  if (event.persisted) return
  let hadClose = false
  try {
    hadClose = sessionStorage.getItem(WINDOW_CLOSE_KEY) != null
    sessionStorage.removeItem(WINDOW_CLOSE_KEY)
  } catch {
    /* ignore */
  }
  if (hadClose) {
    notifyWindowClose(false)
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
