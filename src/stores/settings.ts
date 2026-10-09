import { defineStore } from 'pinia'
import { ref } from 'vue'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types'
import { ipc } from '../services/ipc'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS })
  const loaded = ref(false)

  async function load() {
    settings.value = await ipc.settings.all()
    loaded.value = true
  }

  async function patch(partial: Partial<Settings>) {
    settings.value = await ipc.settings.patch(partial)
  }

  return { settings, loaded, load, patch }
})
