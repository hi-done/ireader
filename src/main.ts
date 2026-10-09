import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import router from './router'
import { ipc } from './services/ipc'

// 渲染层全局错误兜底：未捕获异常与 Promise 拒绝上报主进程日志（{userData}/logs/ireader.log）
window.addEventListener('error', (e) => {
  ipc.log.write('error', `window.onerror: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`)
})
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason instanceof Error ? (e.reason.stack ?? e.reason.message) : String(e.reason)
  ipc.log.write('error', `unhandledrejection: ${reason}`)
})

createApp(App).use(createPinia()).use(router).mount('#app')
