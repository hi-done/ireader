// AI 框选翻译状态：本书记录、在途临时框、选词态、全部隐藏与批量版式操作
// 对应设计文档《20261102-AI框选翻译功能设计方案》§8.3
// 记录来自 SQLite（ai:list / ai:save），pending 只活在会话里：兜底与错误态一律不落库

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AiRect, AiTranslationRecord } from '../../shared/types'
import { ipc } from '../services/ipc'
import { cropPageToJpegBase64 } from '../services/aiCrop'
import { localizeError } from '../i18n/errors'

/** 在途 / 未识别 / 失败 的临时框：不落库，切页或重开书即消失 */
export interface AiPendingBox {
  key: string
  page: number
  rect: AiRect
  status: 'loading' | 'empty' | 'error'
  /** 错误态文案（已本地化） */
  message?: string
}

export const useAiTranslationStore = defineStore('aiTranslation', () => {
  /** 当前书的已落库记录（按 page、createdAt、id 升序，后建的渲染在上层） */
  const records = ref<AiTranslationRecord[]>([])
  const pending = ref<AiPendingBox[]>([])
  /** 选词模式：为真时阅读页禁用热区翻页 / 拖拽平移 / 滚轮翻页 */
  const selecting = ref(false)
  /** 全部隐藏只作用于当前阅读会话，不落库 */
  const hiddenAll = ref(false)
  const activeBookId = ref<number | null>(null)

  let pendingSeq = 0

  /** 载入某书全部译文；期间换书则丢弃本次结果 */
  async function load(bookId: number): Promise<void> {
    activeBookId.value = bookId
    records.value = []
    pending.value = []
    hiddenAll.value = false
    selecting.value = false
    const list = await ipc.ai.list(bookId)
    if (activeBookId.value !== bookId) return
    records.value = list
  }

  function beginSelect(): void {
    selecting.value = true
    hiddenAll.value = false // 选词前先恢复显示，否则新框出现时看不到
  }

  function endSelect(): void {
    selecting.value = false
  }

  /** 结果回来时该框是否还该渲染：换书 / 已删除 pending 都视为失效 */
  function isLive(bookId: number, key: string): boolean {
    return activeBookId.value === bookId && pending.value.some((p) => p.key === key)
  }

  function findRecord(id: number): AiTranslationRecord | undefined {
    return records.value.find((r) => r.id === id)
  }

  function replaceRecord(saved: AiTranslationRecord): void {
    const index = records.value.findIndex((r) => r.id === saved.id)
    if (index >= 0) records.value[index] = saved
  }

  function insertRecord(saved: AiTranslationRecord): void {
    records.value.push(saved)
    records.value.sort(
      (a, b) => a.page - b.page || a.createdAt - b.createdAt || a.id - b.id
    )
  }

  /** 落库载荷：ai:save 是整行覆盖语义，未改动的字段也要带上 */
  function fieldsOf(rec: AiTranslationRecord) {
    const { id, bookId, page, rect, text, fontRatio, collapsed } = rec
    // rect 必须深拷贝：records 里的对象是 Vue reactive 代理，直接过 IPC 会 clone 失败
    return { id, bookId, page, rect: { ...rect }, text, fontRatio, collapsed }
  }

  /**
   * 框选 → 裁图 → 请求翻译 → 落库。
   * await 之后一律先校验 activeBookId 与 pending key：切书 / 离开阅读页 / 点删除后静默丢弃。
   */
  async function selectRect(args: {
    page: number
    rect: AiRect
    canvas: HTMLCanvasElement
    bookTitle: string
  }): Promise<void> {
    const bookId = activeBookId.value
    if (bookId == null) return
    const imageBase64 = cropPageToJpegBase64(args.canvas, args.rect)
    if (!imageBase64) return // canvas 尚未绘制或裁切区域为空：不产生空请求

    const key = `p${args.page}-${++pendingSeq}`
    pending.value.push({ key, page: args.page, rect: args.rect, status: 'loading' })

    try {
      const reply = await ipc.ai.translate({
        bookId,
        page: args.page,
        bookTitle: args.bookTitle,
        imageBase64,
      })
      if (!isLive(bookId, key)) {
        console.info('[ai] 翻译结果已失效，丢弃', key)
        return
      }
      // 图内无文字是合法结果：留灰色兜底框，不落库
      if (!reply.text) {
        const box = pending.value.find((p) => p.key === key)
        if (box) box.status = 'empty'
        return
      }
      const saved = await ipc.ai.save({
        bookId,
        page: args.page,
        rect: args.rect,
        text: reply.text,
        fontRatio: reply.fontRatio,
        collapsed: false,
      })
      if (!isLive(bookId, key)) {
        console.info('[ai] 译文已落库但页面已切换，不再渲染', key)
        return
      }
      pending.value = pending.value.filter((p) => p.key !== key)
      insertRecord(saved)
    } catch (e) {
      if (!isLive(bookId, key)) return
      const box = pending.value.find((p) => p.key === key)
      if (box) {
        box.status = 'error'
        box.message = localizeError(e)
      }
    }
  }

  /** 折叠 / 展开：先改本地再落库，失败回滚（版式操作不阻断阅读） */
  async function setCollapsed(rec: AiTranslationRecord, collapsed: boolean): Promise<void> {
    const target = findRecord(rec.id)
    if (!target || target.collapsed === collapsed) return
    const before = target.collapsed
    target.collapsed = collapsed
    try {
      replaceRecord(await ipc.ai.save({ ...fieldsOf(target), collapsed }))
    } catch (e) {
      const rollback = findRecord(rec.id)
      if (rollback) rollback.collapsed = before
      console.warn('[ai] 折叠状态保存失败', e)
    }
  }

  /**
   * 矩形落库：本地先行 → ai:save 整行覆盖 → 失败回滚（缩放与拖动共用）。
   * 入参来自组件内的响应式预览对象：先转纯对象，赋值与落库都用副本。
   */
  async function commitRect(
    rec: AiTranslationRecord,
    rect: AiRect,
    failMessage: string
  ): Promise<void> {
    const target = findRecord(rec.id)
    if (!target) return
    const next = { ...rect }
    const before = { ...target.rect }
    target.rect = next
    try {
      replaceRecord(await ipc.ai.save({ ...fieldsOf(target), rect: next }))
    } catch (e) {
      const rollback = findRecord(rec.id)
      if (rollback) rollback.rect = before
      console.warn(failMessage, e)
    }
  }

  /** 右下角拖拽松手后落库一次（拖动过程只改本地样式） */
  async function applyResize(rec: AiTranslationRecord, rect: AiRect): Promise<void> {
    await commitRect(rec, rect, '[ai] 译文框尺寸保存失败')
  }

  /** 框体整体拖动松手后落库一次（只换 x/y，宽高由 moveRect 原样带回） */
  async function applyMove(rec: AiTranslationRecord, rect: AiRect): Promise<void> {
    await commitRect(rec, rect, '[ai] 译文框位置保存失败')
  }

  async function remove(rec: AiTranslationRecord): Promise<void> {
    records.value = records.value.filter((r) => r.id !== rec.id)
    try {
      await ipc.ai.remove(rec.id)
    } catch (e) {
      // 本地已移除：失败也不回填，下次开书以库为准
      console.warn('[ai] 译文删除失败', e)
    }
  }

  function removePending(key: string): void {
    pending.value = pending.value.filter((p) => p.key !== key)
  }

  /**
   * 丢弃不在当前显示页上的临时框：兜底 / 错误框不应「翻页再回来又出现」，
   * 在途请求因 key 失效自然被丢弃（不再落库）。
   */
  function prunePending(pages: number[]): void {
    if (!pending.value.length) return
    const visible = new Set(pages)
    pending.value = pending.value.filter((p) => visible.has(p.page))
  }

  /** 批量折叠 / 展开：先退出「全部隐藏」——隐藏态下这两个动作就是显示对应状态 */
  async function setAllCollapsed(collapsed: boolean): Promise<void> {
    hiddenAll.value = false
    const targets = records.value.filter((r) => r.collapsed !== collapsed)
    if (!targets.length) return
    for (const rec of targets) rec.collapsed = collapsed
    await Promise.all(
      targets.map(async (rec) => {
        try {
          replaceRecord(await ipc.ai.save({ ...fieldsOf(rec), collapsed }))
        } catch (e) {
          console.warn('[ai] 批量折叠保存失败', e)
        }
      })
    )
  }

  function collapseAll(): Promise<void> {
    return setAllCollapsed(true)
  }

  function expandAll(): Promise<void> {
    return setAllCollapsed(false)
  }

  function hideAll(): void {
    hiddenAll.value = true
  }

  /** 某页的记录与临时框（覆盖层按页码取，单双页/方向切换后自然命中） */
  function byPage(page: number): {
    records: AiTranslationRecord[]
    pending: AiPendingBox[]
  } {
    return {
      records: records.value.filter((r) => r.page === page),
      pending: pending.value.filter((p) => p.page === page),
    }
  }

  /** 换书 / 离开阅读页：清空并作废在途请求（activeBookId 置空使 isLive 恒假） */
  function reset(bookId: number | null): void {
    activeBookId.value = bookId
    records.value = []
    pending.value = []
    selecting.value = false
    hiddenAll.value = false
  }

  return {
    records,
    pending,
    selecting,
    hiddenAll,
    activeBookId,
    load,
    beginSelect,
    endSelect,
    selectRect,
    setCollapsed,
    applyResize,
    applyMove,
    remove,
    removePending,
    prunePending,
    collapseAll,
    expandAll,
    hideAll,
    byPage,
    reset,
  }
})
