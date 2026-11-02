import { defineStore } from 'pinia'
import { ref } from 'vue'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types'
import { ipc } from '../services/ipc'
import { toIpcPayload } from '../services/ipcPayload'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS })
  const loaded = ref(false)

  async function load() {
    settings.value = await ipc.settings.all()
    loaded.value = true
  }

  async function patch(partial: Partial<Settings>) {
    // 入参可能是 reactive 表单的浅拷贝（嵌套 ai 仍为 Vue 代理），代理对象过 IPC 会抛
    // DataCloneError 且请求到不了主进程，必须在唯一出口处深纯化
    settings.value = await ipc.settings.patch(toIpcPayload(partial))
  }

  return { settings, loaded, load, patch }
})
