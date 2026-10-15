// ReadingTimer 单测：心跳结算、跨天切分、休眠截断、时钟回拨、暂停/换书/停止
// 对应设计文档《阅读时间统计功能设计方案》§11.1

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadingTimer, type ReadingReport } from './readingTimer'

/** 固定测试起点：2026-10-15 10:00:00（本地时区） */
const BASE_TIME = new Date(2026, 9, 15, 10, 0, 0).getTime()

describe('ReadingTimer', () => {
  let reports: ReadingReport[]
  let timer: ReadingTimer | undefined

  /** 创建计时器并记录全部上报 */
  function create(): ReadingTimer {
    timer = new ReadingTimer({ onReport: (r) => reports.push(r) })
    return timer
  }

  beforeEach(() => {
    reports = []
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    vi.setSystemTime(BASE_TIME)
  })

  afterEach(() => {
    timer?.stop()
    timer = undefined
    vi.useRealTimers()
  })

  it('启动后暂停：结算一次已累计时长', () => {
    const t = create()
    t.start(1)
    vi.advanceTimersByTime(20_000)
    t.pause()
    expect(reports).toEqual([{ bookId: 1, day: '2026-10-15', deltaMs: 20_000 }])
  })

  it('心跳周期内自动上报', () => {
    const t = create()
    t.start(1)
    vi.advanceTimersByTime(90_000)
    expect(reports.map((r) => r.deltaMs)).toEqual([30_000, 30_000, 30_000])
    expect(reports.every((r) => r.day === '2026-10-15')).toBe(true)
  })

  it('跨天切分：增量按午夜边界归属两天', () => {
    vi.setSystemTime(new Date(2026, 9, 15, 23, 59, 50))
    const t = create()
    t.start(1)
    vi.advanceTimersByTime(20_000)
    t.pause()
    expect(reports).toEqual([
      { bookId: 1, day: '2026-10-15', deltaMs: 10_000 },
      { bookId: 1, day: '2026-10-16', deltaMs: 10_000 },
    ])
  })

  it('时钟回拨：丢弃该段并重置基准，后续增量正常入账', () => {
    const t = create()
    t.start(1)
    vi.setSystemTime(BASE_TIME - 60_000) // 回拨 1 分钟
    t.pause()
    expect(reports).toHaveLength(0)

    t.resume()
    vi.advanceTimersByTime(10_000)
    t.pause()
    expect(reports).toEqual([{ bookId: 1, day: '2026-10-15', deltaMs: 10_000 }])
  })

  it('休眠恢复：单次结算按上限截断（不虚记挂起时长）', () => {
    const t = create()
    t.start(1)
    // 时间直接跳跃 8 小时且心跳未触发（模拟系统休眠时定时器停摆）
    vi.setSystemTime(BASE_TIME + 8 * 3_600_000)
    t.pause()
    expect(reports).toEqual([{ bookId: 1, day: '2026-10-15', deltaMs: 60_000 }])
  })

  it('暂停期间不计时，恢复后继续累计', () => {
    const t = create()
    t.start(1)
    vi.advanceTimersByTime(10_000)
    t.pause() // 结算 10s
    vi.advanceTimersByTime(60_000) // 暂停 60s：心跳触发但状态非 running，不结算
    t.resume()
    vi.advanceTimersByTime(30_000)
    t.stop()
    // 恢复后到心跳调度边界 20s + stop 收尾 10s；暂停的 60s 不在账内
    expect(reports.map((r) => r.deltaMs)).toEqual([10_000, 20_000, 10_000])
    expect(reports.reduce((sum, r) => sum + r.deltaMs, 0)).toBe(40_000)
  })

  it('换书：先结算旧书再开始新书计时', () => {
    const t = create()
    t.start(1)
    vi.advanceTimersByTime(40_000) // 心跳结算 30s，余 10s 未结算
    t.start(2) // 切书：结算旧书余量
    vi.advanceTimersByTime(30_000)
    t.stop()
    expect(reports).toEqual([
      { bookId: 1, day: '2026-10-15', deltaMs: 30_000 },
      { bookId: 1, day: '2026-10-15', deltaMs: 10_000 },
      { bookId: 2, day: '2026-10-15', deltaMs: 20_000 },
      { bookId: 2, day: '2026-10-15', deltaMs: 10_000 },
    ])
  })

  it('stop 与空闲态操作幂等：无异常、无重复上报', () => {
    const t = create()
    t.pause()
    t.resume()
    expect(t.running).toBe(false)
    expect(reports).toHaveLength(0)

    t.start(1)
    vi.advanceTimersByTime(5_000)
    t.stop()
    expect(reports).toHaveLength(1)

    t.stop()
    t.pause()
    t.resume()
    expect(reports).toHaveLength(1)
    expect(t.running).toBe(false)
  })
})
