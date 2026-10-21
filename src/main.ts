import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import router from './router'
import { ipc } from './services/ipc'
import { useSettingsStore } from './stores/settings'
import { setLocale } from './i18n'
import { resolveLocale } from '../shared/types'

// 渲染层全局错误兜底：未捕获异常与 Promise 拒绝上报主进程日志（{userData}/logs/ireader.log）
window.addEventListener('error', (e) => {
  ipc.log.write('error', `window.onerror: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`)
})
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason instanceof Error ? (e.reason.stack ?? e.reason.message) : String(e.reason)
  ipc.log.write('error', `unhandledrejection: ${reason}`)
})

/**
 * 启动编排：先加载设置确定界面语言，再挂载应用，避免首屏语言闪变。
 * tsconfig target 为 ES2020，不能使用 top-level await，故用 async 函数 + void 调用。
 */
async function bootstrap() {
  const pinia = createPinia()
  const settingsStore = useSettingsStore(pinia) // 必须在 mount 前传入 pinia 实例
  try {
    await settingsStore.load()
  } catch {
    // 主进程不可用时以默认设置（跟随系统）启动，避免白屏
  }
  setLocale(resolveLocale(settingsStore.settings.locale, navigator.language))

  // 设置页切换语言后单点刷新：模板内 t() 读取同一 ref，全站自动重渲染
  watch(
    () => settingsStore.settings.locale,
    (preference) => setLocale(resolveLocale(preference, navigator.language))
  )
  // 跟随系统档：系统语言在运行中变化时同步刷新
  window.addEventListener('languagechange', () => {
    if (settingsStore.settings.locale === 'system') {
      setLocale(resolveLocale('system', navigator.language))
    }
  })

  createApp(App).use(pinia).use(router).mount('#app')
}

void bootstrap()
