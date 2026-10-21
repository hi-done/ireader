<template>
  <div class="settings-view">
    <header class="page-head">
      <button class="ghost" @click="router.push('/')">{{ t('common.back') }}</button>
      <h1>{{ t('settings.title') }}</h1>
    </header>

    <div class="groups">
      <section class="group">
        <h2 class="group-title">{{ t('settings.group.general') }}</h2>
        <div class="group-card">
          <div class="row">
            <span class="row-label">{{ t('settings.language.label') }}</span>
            <SelectMenu
              v-model="form.locale"
              :options="LOCALE_OPTIONS"
              :label="t('settings.language.label')"
              @change="save"
            />
          </div>
        </div>
      </section>

      <section class="group">
        <h2 class="group-title">{{ t('settings.group.reading') }}</h2>
        <div class="group-card">
          <div class="row">
            <span class="row-label">{{ t('settings.mode.label') }}</span>
            <SelectMenu
              v-model="form.defaultMode"
              :options="MODE_OPTIONS"
              :label="t('settings.mode.label')"
              @change="save"
            />
          </div>
          <div class="row">
            <span class="row-label">{{ t('settings.direction.label') }}</span>
            <SelectMenu
              v-model="form.defaultDirection"
              :options="DIRECTION_OPTIONS"
              :label="t('settings.direction.label')"
              @change="save"
            />
          </div>
          <label class="row">
            <span class="row-label">{{ t('settings.preload.label') }}</span>
            <input v-model.number="form.preloadSpreads" type="number" min="0" max="4" @change="save" />
          </label>
          <label class="row">
            <span class="row-label">{{ t('settings.coverSingle.label') }}</span>
            <input v-model="form.coverSinglePage" type="checkbox" @change="save" />
          </label>
        </div>
      </section>

      <section class="group">
        <h2 class="group-title">{{ t('settings.group.appearance') }}</h2>
        <div class="group-card">
          <div class="row">
            <span class="row-label">{{ t('settings.theme.label') }}</span>
            <SelectMenu
              v-model="form.theme"
              :options="THEME_OPTIONS"
              :label="t('settings.theme.label')"
              @change="save"
            />
          </div>
        </div>
      </section>

      <section class="group">
        <h2 class="group-title">{{ t('settings.group.data') }}</h2>
        <div class="group-card">
          <button class="row row-link" @click="router.push('/stats')">
            <span class="row-label">{{ t('settings.data.stats') }}</span>
            <span class="row-value">
              {{ t('settings.data.statsHint') }}
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
        <h2 class="group-title">{{ t('settings.group.about') }}</h2>
        <div class="group-card">
          <div class="row">
            <span class="row-label">{{ t('settings.about.version') }}</span>
            <span class="row-value">IReader v{{ currentVersion }}</span>
          </div>
          <!-- 单行态（仅按钮）标签与按钮垂直居中；出现说明 / 进度等附属行后由样式回退为顶部对齐 -->
          <div class="row update-row" :class="{ 'update-single': singleLine }">
            <span class="row-label">{{ t('settings.update.label') }}</span>
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
              <span v-else-if="state === 'checking'" class="update-text">{{ t('settings.update.checking') }}</span>
              <span v-else-if="state === 'notAvailable'" class="update-text">{{ t('settings.update.upToDate') }}</span>
              <span v-else-if="state === 'available'" class="update-text">
                {{ t('settings.update.available', { version: newVersion ?? '' }) }}
              </span>
              <span v-else-if="state === 'ready'" class="update-text">
                {{ t('settings.update.ready', { version: newVersion ?? '' }) }}
              </span>
              <span v-else-if="errorMsg" class="update-text update-error">{{ errorMsg }}</span>

              <div class="update-actions">
                <button v-if="notesText && state === 'available'" class="ghost" @click="showNotes = !showNotes">
                  {{ showNotes ? t('settings.update.hideNotes') : t('settings.update.showNotes') }}
                </button>
                <button v-if="state === 'downloading'" disabled>{{ t('settings.update.downloading') }}</button>
                <button v-else-if="state === 'checking'" disabled>{{ t('settings.update.checkingButton') }}</button>
                <button v-else-if="state === 'ready'" class="primary" @click="install">
                  {{ t('settings.update.restart') }}
                </button>
                <button v-else-if="state === 'available'" class="primary" @click="downloadOrOpen">
                  {{ autoSupported ? t('settings.update.download') : t('settings.update.gotoDownload') }}
                </button>
                <button v-else-if="errorMsg" @click="retry">{{ t('common.retry') }}</button>
                <button v-else @click="check">{{ t('settings.update.check') }}</button>
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
// 视觉优化对应设计文档《设置与统计页视觉优化设计方案》§5.1；更新功能对应《软件更新功能设计方案》§8；
// 下拉菜单对应《设置页与文库下拉菜单苹果风格美化设计方案》§5.2
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '../stores/settings'
import { IpcError, ipc } from '../services/ipc'
import { cleanReleaseNotes, formatBytes, formatSpeed } from '../services/updateFormat'
import { t } from '../i18n'
import { localizeError } from '../i18n/errors'
import type { SelectOption } from '../services/selectMenu'
import SelectMenu from '../components/ui/SelectMenu.vue'
import type { Direction, LocalePreference, ReadingMode, UpdateProgress } from '../../shared/types'

const router = useRouter()
const settingsStore = useSettingsStore()

const form = reactive({ ...settingsStore.settings })

// 下拉选项：value 与 Settings 字段的字面量联合对齐，SelectMenu 泛型据此推断；
// 含文案的选项一律 computed，切换语言时随 t() 重新求值
const LOCALE_OPTIONS = computed<SelectOption<LocalePreference>[]>(() => [
  { value: 'system', label: t('settings.language.system') },
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
])
const MODE_OPTIONS = computed<SelectOption<ReadingMode>[]>(() => [
  { value: 'single', label: t('settings.mode.single') },
  { value: 'double', label: t('settings.mode.double') },
])
const DIRECTION_OPTIONS = computed<SelectOption<Direction>[]>(() => [
  { value: 'ltr', label: t('settings.direction.ltr') },
  { value: 'rtl', label: t('settings.direction.rtl') },
])
const THEME_OPTIONS = computed<SelectOption<'system' | 'light' | 'dark'>[]>(() => [
  { value: 'system', label: t('settings.theme.system') },
  { value: 'light', label: t('settings.theme.light') },
  { value: 'dark', label: t('settings.theme.dark') },
])

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
  if (!p) return t('settings.update.preparing')
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
    // 主进程 message 仅作日志兜底：IpcError 按 code 映射，其余走本地状态文案
    state.value = 'idle'
    errorMsg.value = e instanceof IpcError ? localizeError(e) : t('settings.update.checkFailed')
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
    errorMsg.value = e instanceof IpcError ? localizeError(e) : t('settings.update.downloadFailed')
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

/* 标签左对齐、弹性宽度：英文长标签允许换行，控件优先 */
.row-label {
  flex: 0 1 200px;
  min-width: 140px;
  font-size: 13.5px;
  color: var(--text-secondary);
  overflow-wrap: break-word;
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
