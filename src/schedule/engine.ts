import type {
  Crew,
  Placement,
  ScheduleDevice,
  ScheduleIssue,
  ScheduleStep,
  SkylightWindow,
  WindowSchedule,
} from './types'

/**
 * 动态排程引擎
 * 规则：
 *  1. 步骤依赖构成有向无环图，前置未排入则后续步骤按「依赖无法满足」列出；
 *  2. 道岔 / 轨道区段 / 信号机按小时段独占，同一设备同一小时段只允许一个步骤占用；
 *  3. 班组必须持有步骤对应设备类型资质，且作业等级 >= 步骤要求等级；
 *     资格独立判定，不被前置失败掩盖（资质不符者始终要被列出来）；
 *  4. 占用按整点段对齐（durationMin 向上取整到小时），超出天窗容量则列出；
 *  5. 时长更新后只释放「当前天窗内」受影响步骤（变更步骤及其传递后继）并重算：
 *     变更步骤钉住原起始小时段（只是时长变长），传递后继按依赖尽早重排，
 *     其余步骤的时间锚点不动；已下发窗口直接保持冻结快照，永不重算。
 */

export interface RecomputeInput {
  window: SkylightWindow
  steps: ScheduleStep[]
  devices: ScheduleDevice[]
  crews: Crew[]
  /** 已冻结的排程（已下发窗口）；存在时原样返回，不重算 */
  frozen?: WindowSchedule
  /** 本次失效重算的步骤范围（变更步骤及其传递后继）；缺省为全量重算 */
  affectedStepIds?: string[]
  /**
   * 修复型重算（班组改派/资格补齐）：已排入步骤锚点不动，
   * 上一版中未排入（排不进去）的步骤及其后继重新参与排布。
   */
  reopenUnplaced?: boolean
  /** 钉住起始时段的步骤（时长变更步骤自身），只在原起点向右延长 */
  pinnedStepIds?: string[]
  baseSchedule?: WindowSchedule // 非受影响步骤的锚点来源
  changeNote?: string
}

function bucketsFor(durationMin: number): number {
  return Math.max(1, Math.ceil(durationMin / 60))
}

function topoOrder(steps: ScheduleStep[]): ScheduleStep[] {
  const byId = new Map(steps.map((s) => [s.id, s]))
  const visited = new Set<string>()
  const onStack = new Set<string>()
  const ordered: ScheduleStep[] = []
  const visit = (step: ScheduleStep, chain: string[]) => {
    if (visited.has(step.id)) return
    if (onStack.has(step.id)) {
      throw new Error(`检测到循环依赖：${[...chain, step.code].join(' → ')}`)
    }
    onStack.add(step.id)
    for (const depId of step.dependencyIds) {
      const dep = byId.get(depId)
      if (dep) visit(dep, [...chain, step.code])
    }
    onStack.delete(step.id)
    visited.add(step.id)
    ordered.push(step)
  }
  [...steps]
    .sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
    .forEach((s) => visit(s, []))
  return ordered
}

/** 计算某步骤的全部传递后继（含自身） */
export function transitiveDependents(steps: ScheduleStep[], rootIds: string[]): Set<string> {
  const result = new Set<string>()
  const stack = [...rootIds]
  while (stack.length) {
    const id = stack.pop()!
    if (result.has(id)) continue
    result.add(id)
    steps.filter((s) => s.dependencyIds.includes(id)).forEach((s) => stack.push(s.id))
  }
  return result
}

function checkQualification(
  step: ScheduleStep,
  crews: Crew[],
): { ok: boolean; reason?: string } {
  if (!step.crewId) {
    return { ok: false, reason: `未指定承接班组（旧数据需升级补齐）` }
  }
  const crew = crews.find((c) => c.id === step.crewId)
  if (!crew) return { ok: false, reason: `班组 ${step.crewId} 不存在或已撤编` }
  if (!crew.qualifications.includes(step.kind)) {
    return {
      ok: false,
      reason: `${crew.name} 无「${step.kind}」作业资质（持有：${crew.qualifications.join('、') || '无'}）`,
    }
  }
  if (crew.level < step.requiredLevel) {
    return {
      ok: false,
      reason: `${crew.name} 作业等级 ${crew.level} 级，低于步骤要求 ${step.requiredLevel} 级`,
    }
  }
  return { ok: true }
}

interface OccupiedCell {
  stepId: string
}

/**
 * 为某步骤寻找最早可放的整点起始桶。
 * minBucket 限定依赖允许的最早桶；返回 null 表示窗口内放不下（设备或容量原因由调用方区分）。
 */
function findEarliest(
  step: ScheduleStep,
  width: number,
  totalBuckets: number,
  occupied: Map<number, OccupiedCell>,
  minBucket: number,
  deviceIndex: Map<string, number[]>,
): number | null {
  for (let start = minBucket; start + width <= totalBuckets; start += 1) {
    let clash = false
    for (const deviceId of step.deviceIds) {
      const cells = deviceIndex.get(deviceId)
      if (!cells) continue
      for (let b = start; b < start + width; b += 1) {
        const cell = occupied.get(cells[b])
        if (cell && cell.stepId !== step.id) {
          clash = true
          break
        }
      }
      if (clash) break
    }
    if (!clash) return start
  }
  return null
}

/** 在指定起始桶检查设备是否空闲（用于钉住起点的时长变更步骤） */
function clashAt(
  step: ScheduleStep,
  startBucket: number,
  width: number,
  occupied: Map<number, OccupiedCell>,
  deviceIndex: Map<string, number[]>,
): boolean {
  for (const deviceId of step.deviceIds) {
    const cells = deviceIndex.get(deviceId)
    if (!cells) continue
    for (let b = startBucket; b < startBucket + width; b += 1) {
      const cell = occupied.get(cells[b])
      if (cell && cell.stepId !== step.id) return true
    }
  }
  return false
}

export function recomputeSchedule(input: RecomputeInput): WindowSchedule {
  const { window, steps, crews, devices } = input

  // 已下发窗口：冻结结果原样返回，任何后续变更都不允许回改
  if (window.status === '已下发' && input.frozen) return input.frozen

  const issues: ScheduleIssue[] = []
  const placements = new Map<string, Placement>()
  const ordered = topoOrder(steps)
  const stepById = new Map(steps.map((s) => [s.id, s]))

  const affected = input.affectedStepIds ? new Set(input.affectedStepIds) : null
  const pinned = new Set(input.pinnedStepIds ?? [])
  const totalBuckets = Math.ceil(window.lengthMin / 60)
  const previouslyPlaced = new Set((input.baseSchedule?.placements ?? []).map((p) => p.stepId))

  // 修复型重算（班组改派/资格补齐）：上一版排不进去的步骤也重新参与排布
  const activeSet = (() => {
    if (!input.reopenUnplaced) return affected
    const set = new Set(affected ?? [])
    for (const step of ordered) if (!previouslyPlaced.has(step.id)) set.add(step.id)
    return set
  })()

  // 设备 -> 每个小时段的占用表下标
  const deviceIndex = new Map<string, number[]>()
  const occupied = new Map<number, OccupiedCell>()
  devices.forEach((device, di) => {
    deviceIndex.set(
      device.id,
      Array.from({ length: totalBuckets }, (_, b) => di * totalBuckets + b),
    )
  })

  const seedPlacement = (p: Placement) => {
    placements.set(p.stepId, p)
    const step = stepById.get(p.stepId)
    if (!step) return
    const startB = p.startMin / 60
    const width = bucketsFor(p.endMin - p.startMin)
    for (const deviceId of step.deviceIds) {
      const cells = deviceIndex.get(deviceId)
      if (!cells) continue
      for (let b = startB; b < startB + width; b += 1) occupied.set(cells[b], { stepId: step.id })
    }
  }

  // 增量重算：非活跃（未受影响、已排入）步骤保留原锚点。
  // 注意：上一版中因「依赖无法满足」而未排入的步骤不携带锚点，其问题也不继承——
  // 班组资格修复可能打开整条后继链，必须重新判定。
  if (activeSet && input.baseSchedule) {
    input.baseSchedule.placements
      .filter((p) => !activeSet.has(p.stepId))
      .forEach(seedPlacement)
    const placedIds = new Set(input.baseSchedule.placements.map((p) => p.stepId))
    input.baseSchedule.issues
      // 只有与依赖解耦的硬性问题（设备争用、容量）可原样继承；
      // 资格问题随班组调整重判，依赖问题可能因前置被修复而消失
      .filter((i) => !activeSet.has(i.stepId) && !placedIds.has(i.stepId) && (i.type === '设备重叠' || i.type === '窗口容量不足'))
      .forEach((i) => issues.push(i))
  }

  const isActive = (step: ScheduleStep) => !activeSet || activeSet.has(step.id)

  // —— 阶段 A：资格独立判定（不看依赖），资质不符者始终列出 ——
  const qualFailed = new Set<string>()
  for (const step of ordered) {
    if (!isActive(step)) continue
    const qual = checkQualification(step, crews)
    if (!qual.ok) {
      qualFailed.add(step.id)
      issues.push({ type: '资格不符', stepId: step.id, reason: qual.reason!, detail: step.title })
    }
  }

  const pushUnplaced = (step: ScheduleStep, type: ScheduleIssue['type'], reason: string) => {
    issues.push({ type, stepId: step.id, reason, detail: step.title })
  }

  // —— 阶段 B：按依赖拓扑排入，设备小时段独占 ——
  for (const step of ordered) {
    if (!isActive(step)) continue // 未受影响：锚点不动

    // 依赖校验：前置必须存在且已排入
    let dependencyBlocked: string | null = null
    let depEnd = 0
    for (const depId of step.dependencyIds) {
      const dep = stepById.get(depId)
      if (!dep) {
        dependencyBlocked = `前置步骤 ${depId} 已不存在`
        break
      }
      const depPlacement = placements.get(depId)
      if (!depPlacement) {
        dependencyBlocked = `前置步骤 ${dep.code} 未能排入，后续步骤不能开始`
        break
      }
      depEnd = Math.max(depEnd, depPlacement.endMin)
    }
    if (dependencyBlocked) {
      // 自身资格已不符的不再重复列依赖问题
      if (!qualFailed.has(step.id)) pushUnplaced(step, '依赖无法满足', dependencyBlocked)
      continue
    }
    if (qualFailed.has(step.id)) continue // 资格问题已在阶段 A 列出

    const width = bucketsFor(step.durationMin)
    const capacityStart = Math.ceil(depEnd / 60)

    let startBucket: number | null
    if (pinned.has(step.id) && input.baseSchedule) {
      // 时长变更步骤：钉住原起始时段向右延长
      const old = input.baseSchedule.placements.find((p) => p.stepId === step.id)
      const pinnedStart = old ? old.startMin / 60 : capacityStart
      if (pinnedStart + width > totalBuckets) {
        pushUnplaced(
          step,
          '窗口容量不足',
          `步骤在原起点第 ${pinnedStart + 1} 时段延长后需 ${width} 个小时段，超出天窗容量 ${totalBuckets} 小时`,
        )
        continue
      }
      startBucket = clashAt(step, pinnedStart, width, occupied, deviceIndex) ? null : pinnedStart
      if (startBucket === null) {
        pushUnplaced(
          step,
          '设备重叠',
          `步骤在原起点延长后，设备 ${step.deviceIds.join('、')} 与未失效步骤的既有小时段占用重叠`,
        )
        continue
      }
    } else {
      startBucket = findEarliest(step, width, totalBuckets, occupied, capacityStart, deviceIndex)
      if (startBucket === null) {
        const fitsWindow = capacityStart + width <= totalBuckets
        if (!fitsWindow) {
          pushUnplaced(
            step,
            '窗口容量不足',
            `步骤需 ${width} 个小时段，最早可开始于第 ${capacityStart + 1} 时段，超出天窗容量 ${totalBuckets} 小时`,
          )
        } else {
          pushUnplaced(
            step,
            '设备重叠',
            `设备 ${step.deviceIds.join('、')} 在依赖满足后的天窗剩余小时段内均被其他步骤独占占用`,
          )
        }
        continue
      }
    }

    seedPlacement({
      stepId: step.id,
      startMin: startBucket * 60,
      endMin: (startBucket + width) * 60,
    })
  }

  // 同一步骤同类问题去重（增量历史问题可能与新判定重合）
  const deduped = issues.filter((issue, index) =>
    issues.findIndex((other) => other.stepId === issue.stepId && other.type === issue.type) === index,
  )

  const orderedPlacements = [...placements.values()].sort(
    (a, b) => a.startMin - b.startMin || (stepById.get(a.stepId)?.code ?? '').localeCompare(stepById.get(b.stepId)?.code ?? ''),
  )

  return {
    windowId: window.id,
    revision: (input.baseSchedule?.revision ?? 0) + 1,
    placements: orderedPlacements,
    issues: deduped,
    recomputedAt: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    changeNote: input.changeNote,
  }
}

/** 发布前门禁：存在任何排不进去的步骤都不允许下发 */
export function releaseGate(schedule: WindowSchedule): { passed: boolean; blockers: ScheduleIssue[] } {
  const blockers = schedule.issues.filter(
    (i) => i.type !== '旧数据缺班组', // 缺班组问题在升级补齐阶段闭环；补齐失败也会以「资格不符」阻断
  )
  return { passed: blockers.length === 0, blockers }
}
