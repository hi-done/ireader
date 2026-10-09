// 主题应用：设置 store 的 theme（light/dark/system）解析后写到 documentElement[data-theme]，
// CSS 变量在 style.css 中按属性切换。阅读页恒定纯黑，不受主题影响。
import { watchEffect } from 'vue'
import { useSettingsStore } from './stores/settings'

export type ResolvedTheme = 'light' | 'dark'

const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

function resolve(theme: 'light' | 'dark' | 'system'): ResolvedTheme {
  if (theme === 'system') return systemDark.matches ? 'dark' : 'light'
  return theme
}

export function applyTheme(theme: 'light' | 'dark' | 'system'): ResolvedTheme {
  const resolved = resolve(theme)
  document.documentElement.dataset.theme = resolved
  return resolved
}

/** 在 App 挂载后调用一次：初始先按系统外观上色（避免设置加载完成前闪错主题），随后跟随设置与系统变化 */
export function initTheme(): void {
  const settingsStore = useSettingsStore()
  applyTheme(settingsStore.loaded ? settingsStore.settings.theme : 'system')

  // 系统深浅切换（theme = system 时实时跟随）
  systemDark.addEventListener('change', () => {
    if (settingsStore.settings.theme === 'system') applyTheme('system')
  })

  // 设置变化（设置页切换主题）
  watchEffect(() => {
    applyTheme(settingsStore.settings.theme)
  })
}
