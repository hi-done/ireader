<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { initTheme } from './theme'
import { exitFullscreen, isFullscreen } from './services/fullscreen'
import { isFullscreenOutsideReader } from './services/fullscreenRoute'

const route = useRoute()

/**
 * 非阅读页的 Esc 兜底：全屏只属于阅读页，其它页面若因系统级原因停在全屏，
 * 这里给一个键盘出口。非全屏时完全不拦截，不影响下拉 / 弹窗 / 表单的既有 Esc 语义；
 * 阅读页的 Esc 由 resolveReaderEsc 在视图内消费，判定时按路由名让位。
 */
function onGlobalEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (!isFullscreenOutsideReader(route.name, isFullscreen.value)) return
  void exitFullscreen()
}

onMounted(() => {
  // macOS 无标题栏窗口：红绿灯悬浮在内容左上，全局样式按平台做顶部控件避让
  document.documentElement.classList.add(
    window.ireader.platform === 'darwin' ? 'platform-mac' : 'platform-other'
  )
  initTheme()
  window.addEventListener('keydown', onGlobalEscape)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalEscape))
</script>

<template>
  <RouterView />
</template>
