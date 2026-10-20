import { describe, expect, it } from 'vitest'
import {
  BURST_SETTLE_MS,
  canReplayBurst,
  EPUB_ANIM_BUDGET_MS,
  LARGE_VIEWPORT_ANIM_BUDGET_MS,
  pickEpubAnimBudget,
  RAPID_GAP_MS,
  TurnPolicy,
  type BurstReplayGate,
  type TurnPolicyInput,
} from './turnPolicy'

/** 测试用翻页上下文：默认单页组前进、无动画、无减弱动态 */
function turn(partial: Partial<TurnPolicyInput> = {}): TurnPolicyInput {
  return {
    now: 0,
    isPageTurn: true,
    indexDelta: 1,
    animating: false,
    reducedMotion: false,
    dragging: false,
    ...partial,
  }
}

describe('TurnPolicy - 连翻判定', () => {
  it('无历史首次翻页播放动画', () => {
    const policy = new TurnPolicy()
    expect(policy.decide(turn({ now: 1000 }))).toEqual({ mode: 'animate', burst: false })
  })

  it('间隔 100ms 的第二次翻页瞬切并开启闩锁', () => {
    const policy = new TurnPolicy()
    policy.decide(turn({ now: 1000 }))
    expect(policy.decide(turn({ now: 1100 }))).toEqual({ mode: 'snap', burst: true })
  })

  it('闩锁期内间隔 300ms 仍瞬切', () => {
    const policy = new TurnPolicy()
    policy.decide(turn({ now: 1000 }))
    policy.decide(turn({ now: 1100 })) // 闩锁至 1600
    expect(policy.decide(turn({ now: 1400 }))).toEqual({ mode: 'snap', burst: true })
  })

  it('闩锁结束且间隔足够后恢复动画', () => {
    const policy = new TurnPolicy()
    policy.decide(turn({ now: 1000 }))
    policy.decide(turn({ now: 1100 })) // 闩锁至 1600
    policy.decide(turn({ now: 1400 }))
    expect(policy.decide(turn({ now: 2100 }))).toEqual({ mode: 'animate', burst: false })
  })

  it('卷曲在播时瞬切并开启闩锁', () => {
    const policy = new TurnPolicy()
    expect(policy.decide(turn({ now: 1000, animating: true }))).toEqual({
      mode: 'snap',
      burst: true,
    })
    expect(policy.decide(turn({ now: 1200 }))).toEqual({ mode: 'snap', burst: true })
  })

  it('一次跨多个页组不做长距离卷曲', () => {
    const policy = new TurnPolicy()
    expect(policy.decide(turn({ now: 1000, indexDelta: 2 }))).toEqual({
      mode: 'snap',
      burst: true,
    })
  })

  it('模式切换瞬切且不污染连翻历史', () => {
    const policy = new TurnPolicy()
    expect(policy.decide(turn({ now: 1000, isPageTurn: false, indexDelta: 0 }))).toEqual({
      mode: 'snap',
      burst: false,
    })
    // 紧随其后的真实翻页距模式切换仅 50ms，仍应播放动画
    expect(policy.decide(turn({ now: 1050 }))).toEqual({ mode: 'animate', burst: false })
  })

  it('系统减弱动态时瞬切', () => {
    const policy = new TurnPolicy()
    expect(policy.decide(turn({ now: 1000, reducedMotion: true }))).toEqual({
      mode: 'snap',
      burst: false,
    })
  })

  it('滑块拖动中瞬切', () => {
    const policy = new TurnPolicy()
    expect(policy.decide(turn({ now: 1000, dragging: true }))).toEqual({
      mode: 'snap',
      burst: false,
    })
  })

  it('连发 20 次（间隔 100ms）仅首次播放动画', () => {
    const policy = new TurnPolicy()
    const modes = Array.from({ length: 20 }, (_, i) =>
      policy.decide(turn({ now: 1000 + i * 100 })).mode
    )
    expect(modes[0]).toBe('animate')
    expect(modes.slice(1).every((m) => m === 'snap')).toBe(true)
  })

  it('reset 后首次翻页重新播放动画', () => {
    const policy = new TurnPolicy()
    policy.decide(turn({ now: 1000 }))
    policy.decide(turn({ now: 1100 }))
    policy.reset()
    expect(policy.decide(turn({ now: 1200 }))).toEqual({ mode: 'animate', burst: false })
  })

  it('自定义阈值生效', () => {
    const policy = new TurnPolicy({ rapidGapMs: 50, quietMs: 100 })
    policy.decide(turn({ now: 1000 }))
    // 间隔 60ms > rapidGapMs 且闩锁未开启，仍播放动画
    expect(policy.decide(turn({ now: 1060 }))).toEqual({ mode: 'animate', burst: false })
  })
})

describe('pickEpubAnimBudget - 视口面积分级', () => {
  it('常规窗口面积使用标准预算', () => {
    expect(pickEpubAnimBudget(1_000_000)).toBe(EPUB_ANIM_BUDGET_MS)
  })

  it('达到大面积阈值使用放宽预算（阈值含）', () => {
    expect(pickEpubAnimBudget(2_000_000)).toBe(LARGE_VIEWPORT_ANIM_BUDGET_MS)
  })

  it('4K 全屏面积同样使用放宽预算', () => {
    expect(pickEpubAnimBudget(8_294_400)).toBe(LARGE_VIEWPORT_ANIM_BUDGET_MS)
  })
})

describe('canReplayBurst - 连翻补播闸门', () => {
  /** 测试用闸门上下文：有位移、有快照、无干扰 */
  function gate(partial: Partial<BurstReplayGate> = {}): BurstReplayGate {
    return {
      tokenValid: true,
      reducedMotion: false,
      hasSnapshot: true,
      startIndex: 3,
      finalIndex: 8,
      startCfi: 'epubcfi(/6/14!/4/2/2[c01])',
      finalCfi: 'epubcfi(/6/18!/4/2/2[c02])',
      queueBusy: false,
      pendingDelta: 0,
      curlActive: false,
      dragging: false,
      ...partial,
    }
  }

  it('有位移且无干扰时允许补播', () => {
    expect(canReplayBurst(gate())).toBe(true)
  })

  it('PDF 语义（CFI 均为 null）按索引判定', () => {
    expect(canReplayBurst(gate({ startCfi: null, finalCfi: null }))).toBe(true)
  })

  it('文档已切换时拒绝', () => {
    expect(canReplayBurst(gate({ tokenValid: false }))).toBe(false)
  })

  it('系统减弱动态时拒绝', () => {
    expect(canReplayBurst(gate({ reducedMotion: true }))).toBe(false)
  })

  it('没有连翻首帧快照时拒绝', () => {
    expect(canReplayBurst(gate({ hasSnapshot: false }))).toBe(false)
  })

  it('队列仍在消费或还有待执行位移时拒绝', () => {
    expect(canReplayBurst(gate({ queueBusy: true }))).toBe(false)
    expect(canReplayBurst(gate({ pendingDelta: 1 }))).toBe(false)
  })

  it('卷曲在播或滑块拖动中拒绝', () => {
    expect(canReplayBurst(gate({ curlActive: true }))).toBe(false)
    expect(canReplayBurst(gate({ dragging: true }))).toBe(false)
  })

  it('起点等于终点（翻过去又翻回来）拒绝', () => {
    expect(canReplayBurst(gate({ finalIndex: 3 }))).toBe(false)
  })

  it('CFI 未变（文字型书同块内）拒绝', () => {
    expect(canReplayBurst(gate({ finalCfi: gate().startCfi }))).toBe(false)
  })

  it('补播静默时长必须大于连翻判定间隔', () => {
    expect(BURST_SETTLE_MS).toBeGreaterThan(RAPID_GAP_MS)
  })
})
