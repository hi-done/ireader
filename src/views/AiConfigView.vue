<template>
  <div class="ai-view">
    <header class="page-head">
      <button class="ghost" @click="router.back()">{{ t('common.back') }}</button>
      <h1>{{ t('ai.title') }}</h1>
    </header>

    <div class="groups">
      <!-- 总开关与译文语言 -->
      <section class="group">
        <div class="group-card">
          <label class="row">
            <span class="row-label">{{ t('ai.enabled') }}</span>
            <input v-model="enabled" type="checkbox" @change="saveEnabled" />
          </label>
          <div class="row">
            <span class="row-label">{{ t('ai.targetLang') }}</span>
            <SelectMenu
              v-model="targetLang"
              :options="LANG_OPTIONS"
              :label="t('ai.targetLang')"
              @change="saveLang"
            />
          </div>
        </div>
        <p class="group-hint">{{ t('ai.enabled.hint') }}</p>
      </section>

      <!-- 模型服务列表与页内表单 -->
      <section class="group">
        <h2 class="group-title">{{ t('ai.provider.title') }}</h2>
        <div class="group-card provider-card">
          <p v-if="!providers.length && !formOpen" class="provider-empty">{{ t('ai.provider.empty') }}</p>

          <div
            v-for="p in providers"
            :key="p.id"
            class="row provider-row"
            :class="{ current: p.id === activeProviderId }"
          >
            <button
              class="provider-pick"
              :aria-pressed="p.id === activeProviderId"
              @click="useProvider(p)"
            >
              <span class="radio" aria-hidden="true"></span>
              <span class="provider-main">
                <span class="provider-name">
                  {{ p.name || p.model }}
                  <span v-if="p.id === activeProviderId" class="badge">{{ t('ai.provider.current') }}</span>
                </span>
                <span class="provider-meta">
                  {{ p.baseUrl }} · {{ p.model }}
                  <template v-if="p.protocol === 'anthropic'"> · {{ t('ai.provider.protocolTag') }}</template>
                </span>
              </span>
            </button>
            <div class="provider-actions">
              <button class="link" @click="openEdit(p)">{{ t('ai.provider.edit') }}</button>
              <button class="link danger" @click="removeProvider(p)">{{ t('ai.provider.delete') }}</button>
            </div>
          </div>

          <form v-if="formOpen" class="form" @submit.prevent="saveDraft">
            <label class="form-row">
              <span class="form-label">{{ t('ai.provider.name') }}</span>
              <input v-model="draft.name" type="text" :placeholder="t('ai.provider.namePlaceholder')" />
            </label>
            <!-- 预设只填草稿：地址与模型名随服务商迭代，用户仍可改 -->
            <div class="form-row">
              <span class="form-label">{{ t('ai.provider.preset') }}</span>
              <span class="preset-field">
                <button type="button" class="link" @click="applyDeepseekPreset">
                  {{ t('ai.provider.presetDeepseek') }}
                </button>
                <span class="form-hint">{{ t('ai.provider.presetHint') }}</span>
              </span>
            </div>
            <div class="form-row">
              <span class="form-label">{{ t('ai.provider.protocol') }}</span>
              <SelectMenu
                v-model="draft.protocol"
                :options="PROTOCOL_OPTIONS"
                :label="t('ai.provider.protocol')"
                @change="resetFeedback"
              />
            </div>
            <label class="form-row">
              <span class="form-label">{{ t('ai.provider.baseUrl') }}</span>
              <input v-model="draft.baseUrl" type="text" :placeholder="baseUrlPlaceholder" spellcheck="false" />
            </label>
            <label class="form-row">
              <span class="form-label">{{ t('ai.provider.apiKey') }}</span>
              <span class="key-field">
                <input
                  v-model="draft.apiKey"
                  :type="showKey ? 'text' : 'password'"
                  spellcheck="false"
                  autocomplete="off"
                />
                <button type="button" class="link" @click="showKey = !showKey">
                  {{ showKey ? t('ai.provider.hideKey') : t('ai.provider.showKey') }}
                </button>
              </span>
            </label>
            <label class="form-row">
              <span class="form-label">{{ t('ai.provider.model') }}</span>
              <input v-model="draft.model" type="text" placeholder="gpt-4o-mini" spellcheck="false" />
            </label>

            <p v-if="formError" class="form-error">{{ formError }}</p>
            <p v-if="testText" class="form-test" :class="{ ok: testOk }">{{ testText }}</p>

            <div class="form-actions">
              <button type="button" :disabled="testing" @click="testDraft">
                {{ testing ? t('ai.provider.testing') : t('ai.provider.test') }}
              </button>
              <span class="spacer"></span>
              <button type="button" @click="closeForm">{{ t('common.cancel') }}</button>
              <button type="submit" class="primary">{{ t('common.confirm') }}</button>
            </div>
          </form>

          <button v-else class="row row-link add-row" @click="openNew">{{ t('ai.provider.add') }}</button>
        </div>
        <p class="group-hint">{{ t('ai.privacy') }}</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
// AI 配置页：总开关 / 译文语言 / 多模型配置（OpenAI 兼容接口）
// 对应设计文档《20261102-AI框选翻译功能设计方案》§9.3
// 写入整对象覆盖 `settings.ai`：避免浅合并残留已删除的配置项
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  type AiProtocol,
  type AiProviderConfig,
  type AiSettings,
  type AiTargetLang,
} from '../../shared/types'
import { ipc } from '../services/ipc'
import type { SelectOption } from '../services/selectMenu'
import { useSettingsStore } from '../stores/settings'
import { t } from '../i18n'
import { localizeError } from '../i18n/errors'
import SelectMenu from '../components/ui/SelectMenu.vue'

const router = useRouter()
const settingsStore = useSettingsStore()

const enabled = ref(false)
const targetLang = ref<AiTargetLang>('zh-CN')
const providers = ref<AiProviderConfig[]>([])
const activeProviderId = ref<number | null>(null)

const LANG_OPTIONS = computed<SelectOption<AiTargetLang>[]>(() => [
  { value: 'zh-CN', label: t('ai.langZh') },
  { value: 'en', label: t('ai.langEn') },
  { value: 'ja', label: t('ai.langJa') },
])

const PROTOCOL_OPTIONS = computed<SelectOption<AiProtocol>[]>(() => [
  { value: 'openai', label: t('ai.provider.protocolOpenai') },
  { value: 'anthropic', label: t('ai.provider.protocolAnthropic') },
])

/** DeepSeek 预设：仅作初值；OpenAI 兼容端点下 deepseek-flash 才支持图像理解 */
const DEEPSEEK_PRESET = {
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  protocol: 'openai' as AiProtocol,
}

/** 页内表单态：editingId 为空表示新增 */
const formOpen = ref(false)
const editingId = ref<number | null>(null)
const draft = reactive({
  name: '',
  baseUrl: '',
  apiKey: '',
  model: '',
  protocol: 'openai' as AiProtocol,
})
/** 地址占位随协议切换：两种协议的根地址形态不同 */
const baseUrlPlaceholder = computed(() =>
  draft.protocol === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'
)
const showKey = ref(false)
const testing = ref(false)
const formError = ref('')
const testText = ref('')
const testOk = ref(false)

onMounted(async () => {
  if (!settingsStore.loaded) await settingsStore.load()
  syncFromStore()
})

function syncFromStore(): void {
  const ai = settingsStore.settings.ai
  enabled.value = ai.enabled
  targetLang.value = ai.targetLang
  providers.value = ai.providers.map((p) => ({ ...p }))
  activeProviderId.value = ai.activeProviderId
}

async function persist(): Promise<void> {
  const ai: AiSettings = {
    enabled: enabled.value,
    targetLang: targetLang.value,
    activeProviderId: activeProviderId.value,
    providers: providers.value.map((p) => ({ ...p })),
  }
  await settingsStore.patch({ ai })
  // 主进程归一化可能改写 activeProviderId（指向已删除配置时置空），回读校准
  syncFromStore()
}

function saveEnabled(): void {
  void persist()
}

function saveLang(): void {
  void persist()
}

function useProvider(p: AiProviderConfig): void {
  if (activeProviderId.value === p.id) return
  activeProviderId.value = p.id
  void persist()
}

function removeProvider(p: AiProviderConfig): void {
  if (!window.confirm(t('ai.provider.deleteConfirm'))) return
  providers.value = providers.value.filter((x) => x.id !== p.id)
  if (activeProviderId.value === p.id) activeProviderId.value = null
  void persist()
}

function resetFeedback(): void {
  formError.value = ''
  testText.value = ''
  testOk.value = false
}

function openNew(): void {
  formOpen.value = true
  editingId.value = null
  Object.assign(draft, { name: '', baseUrl: '', apiKey: '', model: '', protocol: 'openai' as AiProtocol })
  showKey.value = false
  resetFeedback()
}

function openEdit(p: AiProviderConfig): void {
  formOpen.value = true
  editingId.value = p.id
  Object.assign(draft, {
    name: p.name,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    model: p.model,
    protocol: p.protocol,
  })
  showKey.value = false
  resetFeedback()
}

/** 填入 DeepSeek 预设：只改地址/模型/协议，保留已填的名称与 API Key */
function applyDeepseekPreset(): void {
  draft.baseUrl = DEEPSEEK_PRESET.baseUrl
  draft.model = DEEPSEEK_PRESET.model
  draft.protocol = DEEPSEEK_PRESET.protocol
  if (!draft.name.trim()) draft.name = DEEPSEEK_PRESET.name
  resetFeedback()
}

function closeForm(): void {
  formOpen.value = false
  resetFeedback()
}

/** 新增配置的 id：时间戳与现有 id 冲撞时顺延，保证列表选中态不串行 */
function nextProviderId(): number {
  let id = Date.now()
  while (providers.value.some((p) => p.id === id)) id++
  return id
}

function draftProvider(): AiProviderConfig {
  return {
    id: editingId.value ?? nextProviderId(),
    name: draft.name.trim(),
    // 尾部斜杠去掉：请求侧按协议拼 /chat/completions 或 /v1/messages，避免出现双斜杠
    baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: draft.apiKey.trim(),
    model: draft.model.trim(),
    protocol: draft.protocol,
  }
}

/** 表单校验：名称与模型必填，地址必须带协议；密钥允许为空（本地服务常不校验） */
function validate(p: AiProviderConfig): string {
  if (!p.name) return `${t('ai.provider.name')} · ${t('ai.provider.required')}`
  if (!/^https?:\/\//.test(p.baseUrl)) return t('ai.provider.invalidUrl')
  if (!p.model) return `${t('ai.provider.model')} · ${t('ai.provider.required')}`
  return ''
}

async function saveDraft(): Promise<void> {
  const p = draftProvider()
  const error = validate(p)
  if (error) {
    formError.value = error
    return
  }
  const index = providers.value.findIndex((x) => x.id === p.id)
  if (index >= 0) {
    providers.value[index] = p
  } else {
    providers.value = [...providers.value, p]
    // 首个配置自动设为当前使用，省去用户再点一次
    if (activeProviderId.value === null) activeProviderId.value = p.id
  }
  await persist()
  closeForm()
}

async function testDraft(): Promise<void> {
  const p = draftProvider()
  const error = validate(p)
  if (error) {
    formError.value = error
    return
  }
  formError.value = ''
  testText.value = ''
  testing.value = true
  try {
    const result = await ipc.ai.test(p)
    testOk.value = true
    testText.value = t('ai.provider.testOk', { model: result.model, ms: result.latencyMs })
  } catch (e) {
    testOk.value = false
    testText.value = localizeError(e)
  } finally {
    testing.value = false
  }
}
</script>

<style scoped>
/* 背景与页头复用设置页规格 */
.ai-view {
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

.group-hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 0;
  box-sizing: border-box;
  min-height: 60px;
}

.row:not(:last-child) {
  border-bottom: 1px solid var(--border);
}

.row-label {
  flex: 0 1 200px;
  min-width: 140px;
  font-size: 13.5px;
  color: var(--text-secondary);
  overflow-wrap: break-word;
}

/* —— 模型列表行 —— */
.provider-card {
  padding-bottom: 4px;
}

.provider-empty {
  margin: 16px 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
}

.provider-row {
  align-items: center;
  gap: 12px;
}

/* 整块可点的「选中该配置」区域：按钮去边框，点击面覆盖名字与地址 */
.provider-pick {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  text-align: left;
}

.provider-pick:hover:not(:disabled) {
  background: transparent;
}

.radio {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  border: 1px solid var(--text-faint);
  border-radius: 50%;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.provider-row.current .radio {
  border-color: var(--brand);
  /* 内圈实心：品牌色圆点 + 白环 */
  box-shadow: inset 0 0 0 3px var(--surface), inset 0 0 0 8px var(--brand);
}

.provider-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.provider-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  color: var(--text);
}

.provider-meta {
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 11px;
  font-weight: 600;
}

.provider-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
}

/* 文字按钮：无边框、小内边距，危险项悬停变红 */
.link {
  padding: 3px 6px;
  border: none;
  background: transparent;
  font-size: 12.5px;
  color: var(--text-secondary);
}

.link:hover:not(:disabled) {
  background: transparent;
  color: var(--brand);
}

.link.danger:hover:not(:disabled) {
  color: var(--danger);
}

/* —— 新增 / 编辑表单 —— */
.add-row {
  justify-content: flex-start;
  width: calc(100% + 40px);
  margin: 0 -20px;
  padding: 13px 20px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--brand);
  font-size: 13.5px;
  text-align: left;
}

.add-row:hover:not(:disabled) {
  background: var(--surface-2);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 0 16px;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.form-label {
  flex: 0 1 200px;
  min-width: 140px;
  font-size: 13.5px;
  color: var(--text-secondary);
}

.form-row input {
  flex: 1 1 auto;
  min-width: 0;
  box-sizing: border-box;
}

.key-field {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

/* 协议下拉占满值列：与输入框同宽 */
.form-row .select-menu {
  flex: 1 1 auto;
  min-width: 0;
}

.preset-field {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  min-width: 0;
}

/* 按钮内边距清零：与输入框左边缘对齐 */
.preset-field .link {
  padding: 3px 0;
}

.form-hint {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}

.form-error {
  margin: 0;
  font-size: 12.5px;
  color: var(--danger);
}

.form-test {
  margin: 0;
  font-size: 12.5px;
  color: var(--danger);
}

.form-test.ok {
  color: var(--brand);
}

.form-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 2px;
}

.spacer {
  flex: 1 1 auto;
}

@media (max-width: 760px) {
  .groups {
    padding: 16px 20px 40px;
  }

  .form-row {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  .form-label,
  .row-label {
    flex: 0 0 auto;
  }
}
</style>
