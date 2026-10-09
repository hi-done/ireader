<template>
  <div class="settings-view">
    <header class="page-head">
      <button class="ghost" @click="router.push('/')">← 返回</button>
      <h1>设置</h1>
    </header>

    <div class="groups">
      <section class="group">
        <h2 class="group-title">阅读偏好</h2>
        <div class="group-card">
          <label class="row">
            <span class="row-label">默认阅读模式</span>
            <select v-model="form.defaultMode" @change="save">
              <option value="single">单页</option>
              <option value="double">双页</option>
            </select>
          </label>
          <label class="row">
            <span class="row-label">默认阅读方向</span>
            <select v-model="form.defaultDirection" @change="save">
              <option value="ltr">左→右（韩漫）</option>
              <option value="rtl">右→左（日漫）</option>
            </select>
          </label>
          <label class="row">
            <span class="row-label">预加载页组数</span>
            <input v-model.number="form.preloadSpreads" type="number" min="0" max="4" @change="save" />
          </label>
          <label class="row">
            <span class="row-label">双页模式封面单独成页</span>
            <input v-model="form.coverSinglePage" type="checkbox" @change="save" />
          </label>
        </div>
      </section>

      <section class="group">
        <h2 class="group-title">外观</h2>
        <div class="group-card">
          <label class="row">
            <span class="row-label">主题</span>
            <select v-model="form.theme" @change="save">
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '../stores/settings'

const router = useRouter()
const settingsStore = useSettingsStore()

const form = reactive({ ...settingsStore.settings })

onMounted(async () => {
  if (!settingsStore.loaded) await settingsStore.load()
  Object.assign(form, settingsStore.settings)
})

async function save() {
  await settingsStore.patch({ ...form })
}
</script>

<style scoped>
.settings-view {
  height: 100vh;
  overflow-y: auto;
  background: var(--page-veil), url('/bg001.jpg') center / cover no-repeat, var(--bg);
  color: var(--text);
}

.page-head {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 24px 40px 8px;
  background: var(--surface-alpha);
  backdrop-filter: blur(20px) saturate(180%);
}

.page-head h1 {
  font-size: 22px;
}

.groups {
  display: flex;
  flex-direction: column;
  gap: 28px;
  max-width: 640px;
  padding: 20px 40px 48px;
}

.group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  margin: 0 0 8px;
}

.group-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 4px 20px;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 0;
}

.row:not(:last-child) {
  border-bottom: 1px solid var(--border);
}

/* 标签左对齐、统一宽度，控件靠右 */
.row-label {
  flex: 0 0 180px;
  font-size: 13.5px;
  color: var(--text-secondary);
}
</style>
