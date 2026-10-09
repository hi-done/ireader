<script setup lang="ts">
import { onMounted } from 'vue'
import { initTheme } from './theme'

onMounted(() => {
  // macOS 无标题栏窗口：红绿灯悬浮在内容左上，全局样式按平台做顶部控件避让
  document.documentElement.classList.add(
    window.ireader.platform === 'darwin' ? 'platform-mac' : 'platform-other'
  )
  initTheme()
})
</script>

<template>
  <RouterView />
</template>
