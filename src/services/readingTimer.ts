// 阅读计时器：活跃时长结算与跨天切分（纯逻辑，注入时钟便于测试）
// 对应设计文档《阅读时间统计功能设计方案》§8.1

import { formatDayKey } from '../../shared/types'

export interface ReadingReport {
  bookId: number
  /** 本地日期 'YYYY-MM-DD' */
  day: string
  /** 本段增量（ms） */
  deltaMs: number
}

export interface ReadingTimerOptions {
  /** 注入时钟（测试用），默认 Date.now */
  now?: () => number
  /** 心跳周期，默认 30s */
  heartbeatMs?: number
  /** 单次结算增量上限（休眠保护），默认 2 × heartbeatMs */
  maxStepMs?: number
  /** 增量上报回调；跨天切分时单次结算可能触发多条 */
  onReport: (report: ReadingReport) => void
}

type TimerState = 'idle' | 'running' | 'paused'

/** 下一个本地午夜的时间戳 */
function nextLocalMidnight(ts: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

export class ReadingTimer {
  private readonly now: () => number
  private readonly heartbeatMs: number
  private readonly maxStepMs: number
  private readonly onReport: (report: ReadingReport) => void
  private interval: ReturnType<typeof setInterval> | null = null
  private state: TimerState = 'idle'
  private bookId: number | null = null
  /** 上次结算基准时间 */
  private lastTs = 0

  constructor(options: ReadingTimerOptions) {
    this.now = options.now ?? Date.now
    this.heartbeatMs = options.heartbeatMs ?? 30_000
    this.maxStepMs = options.maxStepMs ?? this.heartbeatMs * 2
    this.onReport = options.onReport
  }

  get running(): boolean {
    return this.state === 'running'
  }

  /** 开始计时；已有书在计时时先结算旧书再切新书（换书不丢段） */
  start(bookId: number): void {
    if (!Number.isFinite(bookId)) return
    if (this.state === 'running') this.flush()
    this.bookId = bookId
    this.state = 'running'
    this.lastTs = this.now()
    this.ensureTick()
  }

  /** 结算已累计时长并暂停（页面隐藏/失焦/加载失败时调用；幂等） */
  pause(): void {
    if (this.state !== 'running') return
    this.flush()
    this.state = 'paused'
  }

  /** 恢复计时（暂停期间不计；幂等） */
  resume(): void {
    if (this.state !== 'paused') return
    this.state = 'running'
    this.lastTs = this.now()
  }

  /** 结算 + 停止并清理心跳（离开阅读页时调用；幂等） */
  stop(): void {
    if (this.state === 'running') this.flush()
    this.state = 'idle'
    this.bookId = null
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  private ensureTick(): void {
    if (this.interval) return
    this.interval = setInterval(() => {
      if (this.state === 'running') this.flush()
    }, this.heartbeatMs)
  }

  /** 结算 lastTs → now：截断休眠虚增段，并按午夜边界切分归属日期 */
  private flush(): void {
    if (this.bookId == null) return
    const now = this.now()
    const from = this.lastTs
    this.lastTs = now
    if (now <= from) return // 时钟回拨：丢弃本段（基准已重置）
    const capped = Math.min(now, from + this.maxStepMs)
    let cursor = from
    while (cursor < capped) {
      const segEnd = Math.min(capped, nextLocalMidnight(cursor))
      this.onReport({
        bookId: this.bookId,
        day: formatDayKey(new Date(cursor)),
        deltaMs: segEnd - cursor,
      })
      cursor = segEnd
    }
  }
}
