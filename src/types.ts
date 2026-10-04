export type TestStatus = '未执行' | '执行中' | '通过' | '失败' | '阻塞'

// ===== 检修排班动态排程 =====
export type Qualification = '道岔操作' | '信号机操作' | '轨道区段作业' | '联锁试验' | '绝缘节调整' | '转辙机更换'

export interface Team {
  id: string
  name: string
  leaderId: string
  leaderName: string
}

export interface TeamMember {
  id: string
  name: string
  teamId: string
  qualifications: Qualification[]
}

/** 天窗（检修窗口），按计划号管理 */
export interface MaintenanceWindow {
  id: string
  planId: string        // 计划号
  name: string
  date: string          // YYYY-MM-DD
  startHour: number
  endHour: number
  status: '草稿' | '已下发'
  scope: string
}

/** 某步骤在某天窗内的排程安排 */
export interface ScheduleAssignment {
  planId: string
  windowId: string
  caseId: string
  stepId: string
  startHour: number
  endHour: number
  deviceIds: string[]
  qualifications: Qualification[]
  teamId: string
  teamName: string
  assigneeId: string
  assigneeName: string
  status: '已排' | '失效'
  pinned?: boolean      // 人工改派固定，重算时保留
}

/** 排不进去的步骤及原因 */
export interface ScheduleConflict {
  caseId: string
  stepId: string
  reasons: string[]
}

/** 按计划号的写入状态 */
export interface PlanWriteState {
  planId: string
  windowId: string
  status: '已写入' | '写入失败'
  retryCount: number
  lastError?: string
  lastAttemptAt?: string
}

/** 旧数据升级补齐记录 */
export interface MigrationRecord {
  caseId: string
  stepId?: string
  windowId?: string
  field: string
  source: 'legacy-upgrade'
  filled: string
  at: string
}

export interface StationDevice {
  id: string
  name: string
  kind: '道岔' | '信号机' | '轨道区段'
  x: number
  y: number
  routeIds: string[]
}

export interface RouteRelation {
  id: string
  name: string
  color: string
  points: [number, number][]
  devices: string[]
  affectedBy: string[]
}

export interface TestStep {
  id: string
  action: string
  expected: string
  dependency?: string
  result: '未执行' | '通过' | '失败'
  actual?: string
  evidence?: string
  // ===== 检修排程字段（旧数据缺失时由升级流程补齐） =====
  durationHours?: number
  requiredQualifications?: Qualification[]
  deviceIds?: string[]
  teamId?: string
}

export interface TestCase {
  id: string
  name: string
  routeIds: string[]
  precondition: string
  version: string
  status: TestStatus
  steps: TestStep[]
  failureReason?: string
}

export interface ExecutionRecord {
  id: string
  caseId: string
  operator: string
  startedAt: string
  finishedAt?: string
  snapshot: string
  result: TestStatus
  evidence: string[]
}
