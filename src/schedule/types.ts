// 动态检修排程领域模型
// 天窗内：步骤依赖(有向无环) + 道岔/轨道区段/信号机按小时段独占 + 班组资格校验

export type DeviceKind = '道岔' | '信号机' | '轨道区段'

export interface ScheduleDevice {
  id: string
  name: string
  kind: DeviceKind
}

export interface Crew {
  id: string
  name: string
  ownerUserId: string // 仅班组长本人可调整该班组承接的步骤
  level: number // 可执行作业的最高等级（满足 step.requiredLevel <= crew.level）
  qualifications: DeviceKind[] // 持有的设备作业资格
  legacy?: boolean // 旧台账班组：缺编号步骤升级时优先补齐到该来源
}

export type StepTestKind = DeviceKind

export interface ScheduleStep {
  id: string
  code: string // 计划号体系下的步骤编号（可排序、可读）
  title: string
  kind: StepTestKind // 资格判定基准：班组须持有该设备类型资质
  requiredLevel: number // 最低作业等级
  durationMin: number // 时长（分钟，向上取整到小时段参与独占排程）
  dependencyIds: string[]
  deviceIds: string[] // 独占设备（道岔/轨道区段/信号机）
  crewId?: string // 承接班组；旧数据可能缺失，需升级补齐
  legacy?: boolean // 标记旧来源数据
  legacySource?: string // 旧数据来源说明
}

export interface Placement {
  stepId: string
  startMin: number // 相对天窗开始的分钟偏移（整点段对齐）
  endMin: number // 开区间，endMin <= window.lengthMin
}

export type IssueType = '设备重叠' | '资格不符' | '窗口容量不足' | '依赖无法满足' | '旧数据缺班组'

export interface ScheduleIssue {
  type: IssueType
  stepId: string
  reason: string
  detail: string
}

export type WindowStatus = '草稿' | '已下发'

export interface SkylightWindow {
  id: string
  name: string
  date: string // YYYY-MM-DD
  startHour: number
  lengthMin: number
  status: WindowStatus
  planNo?: string // 下发计划号（下发后用于幂等重试）
  publishedAt?: string
  revision: number // 每次重算 +1，已下发窗口 revision 冻结
}

/** 单个天窗的排程结果 */
export interface WindowSchedule {
  windowId: string
  revision: number
  placements: Placement[]
  issues: ScheduleIssue[]
  recomputedAt: string
  changeNote?: string // 最近一次失效重算的说明
}

export interface AuditEntry {
  at: string
  level: 'info' | 'warn' | 'error'
  message: string
}

/** 下发请求载荷（写入失败后凭 planNo 幂等重试） */
export interface PublishPayload {
  planNo: string
  windowId: string
  revision: number
  steps: Array<{
    stepId: string
    crewId: string
    startMin: number
    endMin: number
    devices: string[]
  }>
}
