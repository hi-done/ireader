// 翻页动画调度策略：判定单次翻页播放卷曲还是瞬切（纯逻辑，无 DOM / 时钟依赖）
// 对应设计文档《翻页动画快速翻页响应优化设计方案-20261020》§4.1

/** 连续翻页判定：相邻翻页间隔小于该值视为连翻（ms） */
export const RAPID_GAP_MS = 160
/** 连翻后静默多久恢复动画（ms）；约等于卷曲时长 450ms + 余量 */
export const RAPID_QUIET_MS = 500
/** 目标页就绪超过该值则放弃补播动画（PDF，ms） */
export const PDF_ANIM_BUDGET_MS = 320
/** 同上，含截图 + epub.js 视图重建（EPUB 非大面积视口，ms） */
export const EPUB_ANIM_BUDGET_MS = 320
/** 大面积视口判定阈值（物理像素 = DIP 宽 × 高 × DPR²，约等于 1080p） */
export const LARGE_VIEWPORT_PIXELS = 2_000_000
/**
 * 大面积视口（全屏 / 高 DPI 大窗口）的动画启动预算（ms）。
 * 全屏截图 → PNG 编码 → IPC → 解码的往返成本远超窗口模式，沿用 320ms 会让整段动画
 * 在播前检查处被静默跳过；放宽只影响「无新输入的单次翻页」是否补播迟到动画，
 * 连翻仍由 pendingDelta 兜底瞬切
 */
export const LARGE_VIEWPORT_ANIM_BUDGET_MS = 1200

/** 按视口物理像素面积选择 EPUB 动画启动预算：达到阈值即放宽 */
export function pickEpubAnimBudget(viewportPixels: number): number {
  return viewportPixels >= LARGE_VIEWPORT_PIXELS
    ? LARGE_VIEWPORT_ANIM_BUDGET_MS
    : EPUB_ANIM_BUDGET_MS
}

/** 一次翻页请求的上下文：由调用方在轮次开始时采样 */
export interface TurnPolicyInput {
  /** performance.now()；由调用方注入，便于单测 */
  now: number
  /** 是否发生页组切换（false = 模式 / 方向 / 缩放导致的重新渲染） */
  isPageTurn: boolean
  /** 相对屏幕已绘制页组的索引差（页组数，可负） */
  indexDelta: number
  /** 是否有卷曲在播（isTurnCurlActive()） */
  animating: boolean
  reducedMotion: boolean
  /** 滑块拖动中 */
  dragging: boolean
}

export interface TurnDecision {
  mode: 'animate' | 'snap'
  /** 本次是否处于连翻闩锁期（true 时调用方跳过快照与淡入） */
  burst: boolean
}

export interface TurnPolicyOptions {
  rapidGapMs?: number
  quietMs?: number
}

/**
 * 连续翻页状态机：间隔极短、动画在播或一次跨多页时退化为瞬切，
 * 瞬切后闩锁一段静默期，避免「翻一下播一下」的半截动画闪烁。
 */
export class TurnPolicy {
  private readonly rapidGapMs: number
  private readonly quietMs: number
  /** 上一次「真实翻页」的时间；null = 尚无历史 */
  private lastTurnAt: number | null = null
  /** 连翻闩锁截止时间：之前的所有翻页一律瞬切 */
  private burstUntil = 0

  constructor(options: TurnPolicyOptions = {}) {
    this.rapidGapMs = options.rapidGapMs ?? RAPID_GAP_MS
    this.quietMs = options.quietMs ?? RAPID_QUIET_MS
  }

  decide(input: TurnPolicyInput): TurnDecision {
    const { now, isPageTurn, indexDelta, animating, reducedMotion, dragging } = input
    // 重排 / 系统减弱动态 / 拖动都不算用户翻页：直接瞬切，且不写入连翻历史
    if (!isPageTurn || reducedMotion || dragging) return { mode: 'snap', burst: false }

    const rapid =
      animating ||
      Math.abs(indexDelta) !== 1 ||
      (this.lastTurnAt !== null && now - this.lastTurnAt < this.rapidGapMs) ||
      now < this.burstUntil
    this.lastTurnAt = now
    if (rapid) {
      this.burstUntil = now + this.quietMs
      return { mode: 'snap', burst: true }
    }
    return { mode: 'animate', burst: false }
  }

  /** 换书 / 离开阅读页：清空连翻历史，下次翻页重新可以播动画 */
  reset(): void {
    this.lastTurnAt = null
    this.burstUntil = 0
  }
}

/** 连翻停手到补播的静默时长（ms）：必须大于 RAPID_GAP_MS，否则会把下一次连点误判为停手 */
export const BURST_SETTLE_MS = 220

/** 连翻补播闸门的输入：全部由调用方采样，便于单测覆盖边界 */
export interface BurstReplayGate {
  /** 会话所属文档仍有效（EPUB：token === openSeq；PDF：turnGen 未变） */
  tokenValid: boolean
  reducedMotion: boolean
  /** 是否拿到连翻首帧快照 */
  hasSnapshot: boolean
  /** 连翻起点页；null = 未建立会话 */
  startIndex: number | null
  /** 最终落点页 */
  finalIndex: number
  /** 起点 / 终点 CFI（EPUB 用于识别「翻过去又翻回来」；PDF 传 null） */
  startCfi: string | null
  finalCfi: string | null
  /** 队列仍在消费（EPUB drainPromise；PDF 恒 false，新轮次由 tokenValid 拦截） */
  queueBusy: boolean
  /** 待执行净位移 */
  pendingDelta: number
  /** 是否有卷曲在播 */
  curlActive: boolean
  /** 滑块拖动中 */
  dragging: boolean
}

/**
 * 连翻补播闸门：只有「文档有效、有位移、无新输入、无在播动画」才允许补播。
 * 宁可不播，也不让旧快照卷到错误页面（详见《连翻补播一次翻页动画设计方案-20261020》§4.1）
 */
export function canReplayBurst(gate: BurstReplayGate): boolean {
  if (!gate.tokenValid || gate.reducedMotion || !gate.hasSnapshot) return false
  if (gate.startIndex == null) return false
  if (gate.queueBusy || gate.pendingDelta !== 0 || gate.curlActive || gate.dragging) return false
  if (gate.finalIndex === gate.startIndex) return false
  // 文字型书一屏翻页可能仍在同一 location 块内：index 未变但 CFI 已变才算有位移
  if (gate.startCfi != null && gate.startCfi === gate.finalCfi) return false
  return true
}
