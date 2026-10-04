import { devices as allDevices, routes } from './mock'
import type { MaintenanceWindow, Qualification, ScheduleAssignment, Team, TeamMember, TestCase, TestStep } from './types'

/** 按设备种类推导所需资质 */
export function deriveQualifications(deviceIds: string[]): Qualification[] {
  const set = new Set<Qualification>()
  deviceIds.forEach((id) => {
    const device = allDevices.find((item) => item.id === id)
    if (!device) return
    if (device.kind === '道岔') set.add('道岔操作')
    if (device.kind === '信号机') set.add('信号机操作')
    if (device.kind === '轨道区段') set.add('轨道区段作业')
  })
  return [...set]
}

/** 解析步骤占用的设备：步骤显式指定 > 用例进路推导 */
export function resolveDeviceIds(step: TestStep, caseItem: TestCase): string[] {
  if (step.deviceIds?.length) return step.deviceIds
  const set = new Set<string>()
  caseItem.routeIds.forEach((routeId) => {
    routes.find((route) => route.id === routeId)?.devices.forEach((id) => set.add(id))
  })
  return [...set]
}

/** 解析步骤所需资质：步骤显式指定 > 按设备种类推导 */
export function resolveQualifications(step: TestStep, deviceIds: string[]): Qualification[] {
  return step.requiredQualifications?.length ? step.requiredQualifications : deriveQualifications(deviceIds)
}

/** 班组是否集体覆盖所需资质（资质不符的班组不得排入） */
export function teamCovers(team: Team, members: TeamMember[], quals: Qualification[]): boolean {
  return quals.every((qual) => members.some((member) => member.teamId === team.id && member.qualifications.includes(qual)))
}

/** 在班组内选一个覆盖资质最多的人员作为指派人 */
export function pickAssignee(teamId: string, members: TeamMember[], quals: Qualification[]): TeamMember {
  const list = members.filter((member) => member.teamId === teamId)
  let best = list[0]!
  let bestScore = -1
  list.forEach((member) => {
    const score = quals.filter((qual) => member.qualifications.includes(qual)).length
    if (score > bestScore) { bestScore = score; best = member }
  })
  return best
}

function overlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1
}

export interface PlacementResult {
  ok: boolean
  assignment?: ScheduleAssignment
  reasons: string[]
}

export interface EngineContext {
  windows: MaintenanceWindow[]
  cases: TestCase[]
  teams: Team[]
  members: TeamMember[]
  assignments: ScheduleAssignment[]
}

export function findCase(cases: TestCase[], stepId: string): TestCase | undefined {
  return cases.find((item) => item.steps.some((step) => step.id === stepId))
}

export function findStep(cases: TestCase[], stepId: string): { caseItem: TestCase; step: TestStep } | undefined {
  for (const caseItem of cases) {
    const step = caseItem.steps.find((item) => item.id === stepId)
    if (step) return { caseItem, step }
  }
  return undefined
}

/** 拓扑排序：依赖步骤排在前面 */
export function topoOrder(cases: TestCase[]): TestStep[] {
  const all: TestStep[] = cases.flatMap((item) => item.steps)
  const visited = new Set<string>()
  const result: TestStep[] = []
  function visit(step: TestStep, trail: Set<string>) {
    if (visited.has(step.id)) return
    if (trail.has(step.id)) return // 环形依赖，跳过
    trail.add(step.id)
    if (step.dependency) {
      const dep = all.find((item) => item.id === step.dependency)
      if (dep) visit(dep, trail)
    }
    visited.add(step.id)
    result.push(step)
  }
  all.forEach((step) => visit(step, new Set()))
  return result
}

interface PreferredSlot {
  windowId?: string
  startHour?: number
  teamId?: string
}

/**
 * 尝试把步骤排入某个草稿天窗。
 * 校验顺序：依赖已排定 → 班组资质 → 窗口时长 → 依赖时间约束 → 设备小时段独占 → 人员时段不冲突。
 * 已下发天窗的排程作为占用参与校验，但不会被改动。
 */
export function tryPlaceStep(step: TestStep, ctx: EngineContext, preferred: PreferredSlot = {}): PlacementResult {
  const found = findStep(ctx.cases, step.id)
  if (!found) return { ok: false, reasons: ['用例或步骤不存在'] }
  const { caseItem } = found
  const deviceIds = resolveDeviceIds(step, caseItem)
  const quals = resolveQualifications(step, deviceIds)
  const duration = step.durationHours ?? 1
  const reasons: string[] = []

  // 1. 依赖必须已排定
  if (step.dependency) {
    const dep = ctx.assignments.find((item) => item.stepId === step.dependency && item.status === '已排')
    if (!dep) reasons.push(`前置步骤 ${step.dependency} 尚未排定`)
  }

  // 2. 资质：具备全部所需资质的班组
  const qualifiedTeams = ctx.teams.filter((team) => teamCovers(team, ctx.members, quals))
  if (!qualifiedTeams.length) reasons.push(`无班组具备 ${quals.join('、')} 资质`)

  // 3. 候选窗口（仅草稿天窗可排）
  const windows = ctx.windows.filter((window) => window.status === '草稿')
  for (const window of windows) {
    if (preferred.windowId && preferred.windowId !== window.id) continue
    for (let hour = window.startHour; hour + duration <= window.endHour; hour += 1) {
      if (preferred.startHour !== undefined && preferred.startHour !== hour) continue

      // 依赖时间约束：必须在依赖步骤完成之后
      if (step.dependency) {
        const dep = ctx.assignments.find((item) => item.stepId === step.dependency && item.status === '已排')
        if (dep) {
          const depWindow = ctx.windows.find((item) => item.id === dep.windowId)
          if (depWindow && (window.date < depWindow.date || (window.date === depWindow.date && hour < dep.endHour))) {
            reasons.push(`早于前置步骤 ${step.dependency} 完成时刻 ${depWindow.date} ${dep.endHour}:00`)
            continue
          }
        }
      }

      // 4. 设备按小时段独占（同日同时段同设备不得重叠）
      const clash = ctx.assignments.find((item) => {
        if (item.status !== '已排' || item.stepId === step.id) return false
        const itemWindow = ctx.windows.find((w) => w.id === item.windowId)
        if (!itemWindow || itemWindow.date !== window.date) return false
        return overlap(item.startHour, item.endHour, hour, hour + duration) && item.deviceIds.some((id) => deviceIds.includes(id))
      })
      if (clash) {
        const clashWindow = ctx.windows.find((w) => w.id === clash.windowId)
        reasons.push(`设备 ${clash.deviceIds.find((id) => deviceIds.includes(id))} 在 ${clashWindow?.date ?? ''} ${clash.startHour}:00-${clash.endHour}:00 已被 ${clash.stepId} 占用`)
        continue
      }

      // 5. 指派班组与人员
      const teamId = preferred.teamId ?? step.teamId
      const team = qualifiedTeams.find((item) => item.id === teamId) ?? qualifiedTeams[0]
      if (!team) continue
      const assignee = pickAssignee(team.id, ctx.members, quals)

      // 6. 人员同日同时段不冲突
      const memberBusy = ctx.assignments.some((item) => {
        if (item.status !== '已排' || item.assigneeId !== assignee.id) return false
        const itemWindow = ctx.windows.find((w) => w.id === item.windowId)
        if (!itemWindow || itemWindow.date !== window.date) return false
        return overlap(item.startHour, item.endHour, hour, hour + duration)
      })
      if (memberBusy) continue

      return {
        ok: true,
        reasons: [],
        assignment: {
          planId: window.planId,
          windowId: window.id,
          caseId: caseItem.id,
          stepId: step.id,
          startHour: hour,
          endHour: hour + duration,
          deviceIds,
          qualifications: quals,
          teamId: team.id,
          teamName: team.name,
          assigneeId: assignee.id,
          assigneeName: assignee.name,
          status: '已排',
          pinned: preferred.teamId ? true : undefined,
        },
      }
    }
  }

  if (!reasons.length) reasons.push(`天窗窗口时长不足 ${duration} 小时`)
  return { ok: false, reasons: [...new Set(reasons)] }
}

export interface RecomputeResult {
  assignments: ScheduleAssignment[]
  conflicts: { caseId: string; stepId: string; reasons: string[] }[]
}

/**
 * 重算草稿天窗排程：
 * - 已下发天窗的排程原样保留（不动）
 * - 人工固定（pinned）的草稿排程保留，其余步骤按依赖顺序重排
 * - 排不进去的步骤进入冲突清单，列出原因
 */
export function recomputeDraftSchedule(ctx: EngineContext, pinned: ScheduleAssignment[]): RecomputeResult {
  const frozen = ctx.assignments.filter((item) => {
    const window = ctx.windows.find((w) => w.id === item.windowId)
    return window?.status === '已下发'
  })
  const frozenStepIds = new Set(frozen.map((item) => item.stepId))
  const kept = [...frozen, ...pinned]
  const placed: ScheduleAssignment[] = []
  const conflicts: RecomputeResult['conflicts'] = []

  for (const step of topoOrder(ctx.cases)) {
    if (frozenStepIds.has(step.id)) continue // 已下发窗口中的步骤不动
    const found = findStep(ctx.cases, step.id)
    if (!found) continue
    const existing = pinned.find((item) => item.stepId === step.id)
    if (existing) { placed.push(existing); continue }
    const result = tryPlaceStep(step, { ...ctx, assignments: [...kept, ...placed] })
    if (result.ok && result.assignment) {
      placed.push(result.assignment)
    } else {
      conflicts.push({ caseId: found.caseItem.id, stepId: step.id, reasons: result.reasons })
    }
  }

  return { assignments: [...frozen, ...placed], conflicts }
}
