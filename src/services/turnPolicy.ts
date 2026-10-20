// 翻页动画调度策略：判定单次翻页播放卷曲还是瞬切（纯逻辑，无 DOM / 时钟依赖）
// 对应设计文档《翻页动画快速翻页响应优化设计方案-20261020》§4.1

/** 连续翻页判定：相邻翻页间隔小于该值视为连翻（ms） */
export const RAPID_GAP_MS = 160
/** 连翻后静默多久恢复动画（ms）；约等于卷曲时长 450ms + 余量 */
export const RAPID_QUIET_MS = 500
/** 目标页就绪超过该值则放弃补播动画（PDF，ms） */
export const PDF_ANIM_BUDGET_MS = 220
/** 同上，含截图 + epub.js 视图重建（EPUB，ms） */
export const EPUB_ANIM_BUDGET_MS = 320

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
