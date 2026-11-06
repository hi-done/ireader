// 合集侧栏「继续阅读」的换书过渡：阶段类型与时长集中于此，父级状态机与组件共用
// 对应设计文档 specs/20261105-合集继续阅读栏3D硬皮书设计方案.md §4.3

/** 换书过渡阶段：idle 常态 / closing 旧书合上下沉 / entering 新书上浮入场 */
export type SideBookPhase = 'idle' | 'closing' | 'entering'

/** 旧书合上并下沉淡出的时长（ms）；比封面合回动画 0.55s 短，留出交接余量 */
export const SIDE_CLOSE_MS = 240

/** 新书上浮入场的时长（ms） */
export const SIDE_ENTER_MS = 320
