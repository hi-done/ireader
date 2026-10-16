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

      <section class="group">
        <h2 class="group-title">数据</h2>
        <div class="group-card">
          <button class="row row-link" @click="router.push('/stats')">
            <span class="row-label">阅读时间统计</span>
            <span class="row-value">
              查看阅读足迹
              <svg class="chevron" width="7" height="12" viewBox="0 0 7 12" aria-hidden="true">
                <path
                  d="M1 1 L6 6 L1 11"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
          </button>
        </div>
      </section>

      <section class="group">
        <h2 class="group-title">关于</h2>
        <div class="group-card">
          <div class="row">
            <span class="row-label">当前版本</span>
            <span class="row-value">IReader v{{ currentVersion }}</span>
          </div>
          <!-- 单行态（仅按钮）标签与按钮垂直居中；出现说明 / 进度等附属行后由样式回退为顶部对齐 -->
          <div class="row update-row" :class="{ 'update-single': singleLine }">
            <span class="row-label">软件更新</span>
            <div class="update-body">
              <!-- 更新说明：清洗后的纯文本，可折叠，限高内滚动 -->
              <p v-if="notesVisible" class="update-notes">{{ notesText }}</p>

              <!-- 下载进度：细进度条 + 数字行 -->
              <div v-if="state === 'downloading'" class="update-progress">
                <div class="progress-track">
                  <div class="progress-fill" :style="{ width: `${progressPercent}%` }"></div>
                </div>
                <span class="progress-text">{{ progressText }}</span>
              </div>
              <span v-else-if="state === 'checking'" class="update-text">正在检查更新…</span>
              <span v-else-if="state === 'notAvailable'" class="update-text">已是最新版本</span>
              <span v-else-if="state === 'available'" class="update-text">发现新版本 v{{ newVersion }}</span>
              <span v-else-if="state === 'ready'" class="update-text">v{{ newVersion }} 已就绪，重启后自动完成安装</span>
              <span v-else-if="errorMsg" class="update-text update-error">{{ errorMsg }}</span>

              <div class="update-actions">
                <button v-if="notesText && state === 'available'" class="ghost" @click="showNotes = !showNotes">
                  {{ showNotes ? '收起说明' : '查看说明' }}
                </button>
                <button v-if="state === 'downloading'" disabled>下载中…</button>
                <button v-else-if="state === 'checking'" disabled>检查中…</button>
                <button v-else-if="state === 'ready'" class="primary" @click="install">重启并安装</button>
                <button v-else-if="state === 'available'" class="primary" @click="downloadOrOpen">
                  {{ autoSupported ? '下载更新' : '前往下载' }}
                </button>
                <button v-else-if="errorMsg" @click="retry">重试</button>
                <button v-else @click="check">检查更新</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
// 设置页：阅读偏好、外观、数据入口与关于（版本 + 应用内更新）
// 视觉优化对应设计文档《设置与统计页视觉优化设计方案》§5.1；更新功能对应《软件更新功能设计方案》§8
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '../stores/settings'
import { IpcError, ipc } from '../services/ipc'
import { cleanReleaseNotes, formatBytes, formatSpeed } from '../services/updateFormat'
import type { UpdateProgress } from '../../shared/types'

const router = useRouter()
const settingsStore = useSettingsStore()

const form = reactive({ ...settingsStore.settings })

onMounted(async () => {
  if (!settingsStore.loaded) await settingsStore.load()
  Object.assign(form, settingsStore.settings)
  // 恢复主进程更新状态（用户可能离开过设置页，下载在后台继续），并订阅下载进度
  void restoreStatus()
  cancelProgress = ipc.updater.onProgress((p) => {
    progress.value = p
  })
})

onBeforeUnmount(() => {
  // 只取消进度订阅：主进程下载任务继续，回到本页经 updater:status 恢复
  cancelProgress?.()
})

async function save() {
  await settingsStore.patch({ ...form })
}

// —— 应用内更新（「关于」分组）：本地状态与主进程 updaterService 同步 ——

type UpdateState = 'idle' | 'checking' | 'available' | 'notAvailable' | 'downloading' | 'ready'

const currentVersion = ref('')
const autoSupported = ref(true)
const state = ref<UpdateState>('idle')
const newVersion = ref<string | null>(null)
const notesText = ref('')
const showNotes = ref(true)
const progress = ref<UpdateProgress | null>(null)
const errorMsg = ref('')
// 失败重试的动作来源：检查失败重查、下载失败重下
let lastAction: 'check' | 'download' | null = null
// macOS「前往下载」的跳转地址（由主进程拼接并白名单放行，渲染层不拼 URL）
let releaseUrl: string | null = null
let cancelProgress: (() => void) | null = null

const notesVisible = computed(() => state.value === 'available' && showNotes.value && Boolean(notesText.value))
// 单行内容（右侧仅操作按钮）时标签与按钮垂直居中；出现说明 / 进度 / 状态文案后标签回顶部对齐
const singleLine = computed(() => state.value === 'idle')
const progressPercent = computed(() => Math.round(progress.value?.percent ?? 0))
const progressText = computed(() => {
  const p = progress.value
  if (!p) return '准备下载…'
  return `${progressPercent.value}% · ${formatBytes(p.transferred)} / ${formatBytes(p.total)} · ${formatSpeed(p.bytesPerSecond)}`
})

async function restoreStatus() {
  try {
    const s = await ipc.updater.status()
    currentVersion.value = s.currentVersion
    autoSupported.value = s.autoUpdateSupported
    state.value = s.state
    newVersion.value = s.newVersion
    progress.value = s.progress
  } catch {
    // status 为本地 IPC 不应失败；兜底显示占位符
    currentVersion.value = '—'
  }
}

async function check() {
  if (state.value === 'checking' || state.value === 'downloading') return
  state.value = 'checking'
  errorMsg.value = ''
  lastAction = 'check'
  try {
    const result = await ipc.updater.check()
    state.value = result.isUpdateAvailable ? 'available' : 'notAvailable'
    newVersion.value = result.newVersion
    notesText.value = result.releaseNotes ? cleanReleaseNotes(result.releaseNotes) : ''
    showNotes.value = true
    releaseUrl = result.releaseUrl
    autoSupported.value = result.autoUpdateSupported
  } catch (e) {
    // 服务层已保证中文 message（UPDATER_UNAVAILABLE / UPDATER_FAILED）
    state.value = 'idle'
    errorMsg.value = e instanceof IpcError ? e.message : '检查更新失败'
  }
}

async function download() {
  if (state.value !== 'available') return
  state.value = 'downloading'
  errorMsg.value = ''
  progress.value = null
  lastAction = 'download'
  try {
    await ipc.updater.download()
    state.value = 'ready'
  } catch (e) {
    // 失败回 available：保留「下载更新」按钮供重试
    state.value = 'available'
    errorMsg.value = e instanceof IpcError ? e.message : '下载更新失败'
  }
}

/** available 态主按钮：Windows 走下载，macOS 跳转浏览器（Release 页，主进程白名单放行） */
async function downloadOrOpen() {
  if (autoSupported.value) {
    await download()
  } else if (releaseUrl) {
    try {
      await ipc.shell.openExternal(releaseUrl)
    } catch {
      // 跳转失败不构成阻塞错误（url 由主进程拼接、白名单必过，仅剩系统层异常）
    }
  }
}

function install() {
  // 安装即退出应用（静默装回原目录并自动重启），返回值无消费方
  ipc.updater.install()
}

function retry() {
  if (lastAction === 'download') void download()
  else void check()
}
</script>

<style scoped>
.settings-view {
  height: 100vh;
  overflow-y: auto;
  background: var(--page-veil), url('/bg001.jpg') center / cover no-repeat, var(--bg);
  color: var(--text);
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
  /* 统一行高：以最高的控件行（select/input ≈ 60px）为基准，文字行 / 入口行 / checkbox 行由 min-height 撑齐；
     全局未设 border-box，这里须显式声明让 min-height 含 padding；软件更新行多行态内容更高时自然撑开 */
  box-sizing: border-box;
  min-height: 60px;
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

/* 「数据」分组入口行：整行可点，负边距撑满卡片宽度 */
.row-link {
  width: calc(100% + 40px);
  margin: 0 -20px;
  padding: 13px 20px;
  border: none;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.row-link:hover {
  background: var(--surface-2);
}

.row-value {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-muted);
  transition: color 0.15s ease;
}

.row-link:hover .row-value {
  color: var(--brand);
}

.chevron {
  color: var(--text-faint);
  transition: color 0.15s ease;
}

/* hover 时箭头与文字同步变品牌色（此前箭头恒为灰色，与文字变色脱节） */
.row-link:hover .chevron {
  color: var(--brand);
}

/* —— 「软件更新」行：右侧状态区（说明 / 进度条 / 按钮纵向堆叠，右对齐）—— */
.update-row {
  align-items: flex-start;
}

/* 单行态（右侧仅按钮一行）：标签与按钮垂直居中，与其他设置行观感一致 */
.update-row.update-single {
  align-items: center;
}

.update-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}

.update-text {
  font-size: 13px;
  color: var(--text-secondary);
}

.update-error {
  color: var(--danger);
}

/* 更新说明：清洗后纯文本；全局未设 border-box，这里局部声明防止 padding 撑破容器 */
.update-notes {
  box-sizing: border-box;
  margin: 0;
  width: 100%;
  max-height: 180px;
  overflow-y: auto;
  padding: 10px 12px;
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  background: var(--surface-2);
  border-radius: 8px;
}

.update-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 下载进度：细轨道 + 品牌色填充（宽度随广播频率平滑过渡） */
.update-progress {
  width: 100%;
}

.progress-track {
  height: 6px;
  border-radius: 3px;
  background: var(--placeholder);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--brand);
  transition: width 0.2s ease;
}

.progress-text {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: right;
}
</style>
