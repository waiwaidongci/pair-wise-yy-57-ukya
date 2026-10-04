import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { recomputeSchedule, transitiveDependents, releaseGate, type RecomputeInput } from './engine'
import { publishWindow, setFailNextWrite } from './api'
import { crews as seedCrews, frozenW2Schedule, scheduleDevices, seedSteps, seedWindows, users } from './seed'
import type {
  AuditEntry,
  Crew,
  ScheduleDevice,
  ScheduleStep,
  SkylightWindow,
  WindowSchedule,
} from './types'

const STORAGE_KEY = 'yy57-schedule-dynamic-v1'

interface PersistShape {
  steps: ScheduleStep[]
  windows: SkylightWindow[]
  schedules: Record<string, WindowSchedule>
  audits: AuditEntry[]
  pendingPlanNo: Record<string, string>
  migrated: string[]
  seq: number
}

function now() {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function windowIdOfStep(step: ScheduleStep): string {
  return step.code.startsWith('W2') ? 'W-2' : 'W-1'
}

export const useScheduleStore = defineStore('schedule', () => {
  const devices = ref<ScheduleDevice[]>([...scheduleDevices])
  const crewList = ref<Crew[]>(structuredClone(seedCrews))
  const steps = ref<ScheduleStep[]>(structuredClone(seedSteps))
  const windows = ref<SkylightWindow[]>(structuredClone(seedWindows))
  const audits = ref<AuditEntry[]>([])
  const migratedStepIds = ref<string[]>([])
  const pendingPlanNo = ref<Record<string, string>>({})
  const planSeq = ref(18)
  const currentUserId = ref('u-luchen')
  const selectedWindowId = ref('W-1')
  const publishing = ref(false)
  const failNextWrite = ref(false)
  const writeError = ref('')
  const lastGoodKept = ref(false)
  let lastGoodRaw: string | null = null

  const deviceMap = computed(() => new Map(devices.value.map((d) => [d.id, d])))
  const crewMap = computed(() => new Map(crewList.value.map((c) => [c.id, c])))
  const usersList = users
  const currentUser = computed(() => users.find((u) => u.id === currentUserId.value)!)

  const selectedWindow = computed(
    () => windows.value.find((w) => w.id === selectedWindowId.value) ?? windows.value[0],
  )
  const windowSteps = computed(() =>
    steps.value.filter((s) => windowIdOfStep(s) === selectedWindowId.value),
  )

  // 每个窗口的排程结果（已下发窗口为冻结快照）
  const schedules = ref<Record<string, WindowSchedule>>({
    'W-2': structuredClone(frozenW2Schedule),
  })
  const currentSchedule = computed(() => schedules.value[selectedWindowId.value])
  const currentGate = computed(() =>
    currentSchedule.value ? releaseGate(currentSchedule.value) : { passed: false, blockers: [] },
  )

  function log(level: AuditEntry['level'], message: string) {
    audits.value.unshift({ at: now(), level, message })
  }

  // ---------- 旧数据升级：缺班组编号的步骤按设备类型+等级补齐来源 ----------
  function upgradeLegacyCrews() {
    for (const step of steps.value) {
      if (step.crewId) continue
      const eligible = crewList.value.filter(
        (c) => c.qualifications.includes(step.kind) && c.level >= step.requiredLevel,
      )
      // 旧台账步骤优先补齐到旧来源工班；没有旧来源标记时退化为按等级最高的在编班组
      const match = step.legacy
        ? eligible.find((c) => c.legacy) ?? eligible[0]
        : eligible.slice().sort((a, b) => b.level - a.level)[0]
      if (match) {
        step.crewId = match.id
        migratedStepIds.value.push(step.id)
        log(
          'info',
          `旧数据升级：${step.code}「${step.title}」缺班组编号，按 ${step.kind} 资质/${step.requiredLevel} 级要求补齐为 ${match.name}（来源：${step.legacySource ?? '旧台账'}）`,
        )
      } else {
        log(
          'error',
          `旧数据升级失败：${step.code}「${step.title}」缺班组编号，且无具备 ${step.kind} 资质/${step.requiredLevel} 级的在编班组，需人工补齐`,
        )
      }
    }
  }

  function stepsOfWindow(windowId: string) {
    return steps.value.filter((s) => windowIdOfStep(s) === windowId)
  }

  function buildSchedule(
    windowId: string,
    options: { affected?: Set<string>; pinned?: Set<string>; reopenUnplaced?: boolean; note?: string } = {},
  ) {
    const win = windows.value.find((w) => w.id === windowId)!
    if (win.status === '已下发') {
      log('warn', `已下发窗口 ${win.planNo} 不参与重算，保持原计划时间不动`)
      return schedules.value[windowId]
    }
    const input: RecomputeInput = {
      window: win,
      steps: stepsOfWindow(windowId),
      devices: devices.value,
      crews: crewList.value,
      baseSchedule: schedules.value[windowId],
      affectedStepIds: options.affected ? [...options.affected] : undefined,
      pinnedStepIds: options.pinned ? [...options.pinned] : undefined,
      reopenUnplaced: options.reopenUnplaced,
      changeNote: options.note,
    }
    const result = recomputeSchedule(input)
    schedules.value[windowId] = result
    win.revision = result.revision
    return result
  }

  // ---------- 权限：仅班组长本人可调整本班组承接的步骤 ----------
  function assertCanEdit(step: ScheduleStep): { ok: true } | { ok: false; reason: string } {
    const win = windows.value.find((w) => w.id === windowIdOfStep(step))!
    if (win.status === '已下发') {
      return { ok: false, reason: `窗口已按计划号 ${win.planNo} 下发，步骤为只读冻结版本` }
    }
    if (!step.crewId) {
      return { ok: false, reason: `${step.code} 尚未补齐承接班组，不能调整` }
    }
    const crew = crewMap.value.get(step.crewId)
    if (!crew) return { ok: false, reason: `${step.code} 的承接班组不存在` }
    if (crew.ownerUserId !== currentUserId.value) {
      const owner = users.find((u) => u.id === crew.ownerUserId)
      return {
        ok: false,
        reason: `越权拒绝：${currentUser.value.name} 不是 ${crew.name} 班组长（仅 ${owner?.name ?? crew.ownerUserId} 可调整），操作已拒绝并记录`,
      }
    }
    return { ok: true }
  }

  /** 时长更新：当前天窗内后续步骤（传递后继）失效并重算，已下发窗口不动 */
  function updateDuration(stepId: string, durationMin: number): { ok: boolean; message: string } {
    const step = steps.value.find((s) => s.id === stepId)
    if (!step) return { ok: false, message: '步骤不存在' }
    const guard = assertCanEdit(step)
    if (!guard.ok) {
      log('warn', guard.reason)
      return { ok: false, message: guard.reason }
    }
    if (durationMin <= 0 || durationMin > 480) {
      return { ok: false, message: '时长须在 1–480 分钟之间' }
    }
    const before = step.durationMin
    if (before === durationMin) return { ok: true, message: '时长未变化' }
    const windowId = windowIdOfStep(step)
    const affected = transitiveDependents(stepsOfWindow(windowId), [stepId])
    step.durationMin = durationMin
    const downstream = [...affected].filter((id) => id !== stepId)
    const note = `${step.code} 时长 ${before} → ${durationMin} 分钟，天窗内 ${downstream.length} 个后续步骤时间锚点失效并已重算`
    buildSchedule(windowId, { affected, pinned: new Set([stepId]), note })
    log('info', note)
    persist()
    const result = schedules.value[windowId]
    return {
      ok: true,
      message: `${note}；重算后 ${result.placements.length} 个步骤排入，${result.issues.length} 个步骤排不进去`,
    }
  }

  /** 调整承接班组（同样走班组长权限 + 受影响链路重算） */
  function assignCrew(stepId: string, crewId: string): { ok: boolean; message: string } {
    const step = steps.value.find((s) => s.id === stepId)
    if (!step) return { ok: false, message: '步骤不存在' }
    const guard = assertCanEdit(step)
    if (!guard.ok) {
      log('warn', guard.reason)
      return { ok: false, message: guard.reason }
    }
    const target = crewMap.value.get(crewId)
    if (!target) return { ok: false, message: '目标班组不存在' }
    const windowId = windowIdOfStep(step)
    const oldName = crewMap.value.get(step.crewId!)?.name ?? '未分配'
    step.crewId = crewId
    const note = `${step.code} 承接班组由 ${oldName} 调整为 ${target.name}，资格重判，已排入步骤锚点不动、原先排不进去的步骤重新排布`
    // 修复型重算：已排入步骤保持不动，未排入步骤（含因资格/依赖被阻断的整条链）重新排布
    buildSchedule(windowId, { reopenUnplaced: true, note })
    log('info', note)
    persist()
    const result = schedules.value[windowId]
    return { ok: true, message: `${note}；当前 ${result.issues.length} 个步骤排不进去` }
  }

  // ---------- 发布：门禁 + 计划号幂等重试，失败保留原可执行版本 ----------
  function ensurePlanNo(windowId: string): string {
    if (!pendingPlanNo.value[windowId]) {
      const win = windows.value.find((w) => w.id === windowId)!
      planSeq.value += 1
      pendingPlanNo.value[windowId] = `JH-${win.date.replaceAll('-', '')}-${String(win.startHour).padStart(2, '0')}-${String(planSeq.value).padStart(3, '0')}`
    }
    return pendingPlanNo.value[windowId]
  }

  async function publishSelectedWindow(): Promise<{ ok: boolean; message: string }> {
    const win = selectedWindow.value
    if (win.status === '已下发') {
      return { ok: false, message: `该窗口已下发（计划号 ${win.planNo}），不能重复下发` }
    }
    const schedule = schedules.value[win.id]
    const gate = releaseGate(schedule)
    if (!gate.passed) {
      const summary = gate.blockers.map((b) => `${b.type}：${steps.value.find((s) => s.id === b.stepId)?.code}`).join('；')
      log('warn', `发布检查未通过（${gate.blockers.length} 项阻断）：${summary}`)
      return { ok: false, message: `发布检查未通过：${summary}` }
    }

    const planNo = ensurePlanNo(win.id)
    if (failNextWrite.value) {
      setFailNextWrite(true)
      failNextWrite.value = false
    }
    publishing.value = true
    const payload = {
      planNo,
      windowId: win.id,
      revision: schedule.revision,
      steps: schedule.placements.map((p) => {
        const s = steps.value.find((x) => x.id === p.stepId)!
        return { stepId: s.id, crewId: s.crewId!, startMin: p.startMin, endMin: p.endMin, devices: s.deviceIds }
      }),
    }
    try {
      const res = await publishWindow(payload)
      // 成功后冻结：状态、计划号、排程快照均不再变化
      win.status = '已下发'
      win.planNo = planNo
      win.publishedAt = now()
      schedules.value[win.id] = structuredClone(schedule)
      delete pendingPlanNo.value[win.id]
      log('info', `窗口 ${win.name} 下发成功，计划号 ${planNo}${res.idempotentHit ? '（服务端识别为同计划号重试，幂等返回）' : ''}`)
      persist()
      return { ok: true, message: `下发成功，计划号 ${planNo}${res.idempotentHit ? '（幂等重试成功）' : ''}` }
    } catch (err) {
      // 写入失败：窗口状态与排程均保持原可执行版本，只记录计划号供重试
      writeError.value = (err as Error).message
      lastGoodKept.value = true
      log('error', `下发写入失败，已保留当前可执行版本；请按计划号 ${planNo} 重试。${(err as Error).message}`)
      persist()
      return { ok: false, message: `写入失败，原可执行版本已保留；请用计划号 ${planNo} 重试` }
    } finally {
      publishing.value = false
    }
  }

  function setFailNextWriteFlag(value: boolean) {
    failNextWrite.value = value
  }

  function selectWindow(id: string) {
    selectedWindowId.value = id
  }
  function switchUser(id: string) {
    currentUserId.value = id
    log('info', `当前操作人切换为 ${users.find((u) => u.id === id)?.name}`)
    persist()
  }

  // ---------- 本地持久化：失败时保留最近可执行版本 ----------
  function snapshot(): PersistShape {
    return {
      steps: steps.value,
      windows: windows.value,
      schedules: schedules.value,
      audits: audits.value.slice(0, 50),
      pendingPlanNo: pendingPlanNo.value,
      migrated: migratedStepIds.value,
      seq: planSeq.value,
    }
  }

  function persist() {
    const raw = JSON.stringify(snapshot())
    try {
      localStorage.setItem(STORAGE_KEY, raw)
      lastGoodRaw = raw
      writeError.value = ''
      lastGoodKept.value = false
    } catch (err) {
      // 持久化失败不回滚内存中的可执行版本；下次成功写入前持续告警
      writeError.value = `本地快照写入失败，已保留内存中的可执行版本：${(err as Error).message}`
      lastGoodKept.value = true
      log('error', writeError.value)
    }
  }

  function applySnapshot(data: PersistShape) {
    steps.value = data.steps
    windows.value = data.windows
    schedules.value = data.schedules
    audits.value = data.audits ?? []
    pendingPlanNo.value = data.pendingPlanNo ?? {}
    migratedStepIds.value = data.migrated ?? []
    planSeq.value = data.seq ?? 18
  }

  function restore() {
    let raw: string | null = null
    try {
      raw = localStorage.getItem(STORAGE_KEY)
    } catch {
      raw = null
    }
    if (raw) {
      try {
        applySnapshot(JSON.parse(raw) as PersistShape)
        lastGoodRaw = raw
      } catch {
        log('warn', '本地快照损坏，已回退到最近可执行种子版本')
      }
    }
    // 无论是否恢复过快照，旧数据缺班组编号都要升级补齐
    upgradeLegacyCrews()
    // 草稿窗口按升级后的数据重算一次；已下发窗口继续使用冻结快照
    windows.value
      .filter((w) => w.status === '草稿')
      .forEach((w) => buildSchedule(w.id))
    persist()
  }

  function resetDraft() {
    localStorage.removeItem(STORAGE_KEY)
    steps.value = structuredClone(seedSteps)
    windows.value = structuredClone(seedWindows)
    schedules.value = { 'W-2': structuredClone(frozenW2Schedule) }
    audits.value = []
    pendingPlanNo.value = {}
    migratedStepIds.value = []
    planSeq.value = 18
    selectedWindowId.value = 'W-1'
    upgradeLegacyCrews()
    buildSchedule('W-1')
    persist()
    log('info', '草稿窗口已重置为初始种子数据')
  }

  restore()

  return {
    // state
    devices,
    crewList,
    steps,
    windows,
    audits,
    migratedStepIds,
    pendingPlanNo,
    currentUserId,
    selectedWindowId,
    publishing,
    failNextWrite,
    writeError,
    lastGoodKept,
    // getters
    deviceMap,
    crewMap,
    usersList,
    currentUser,
    selectedWindow,
    windowSteps,
    currentSchedule,
    currentGate,
    // actions
    selectWindow,
    switchUser,
    updateDuration,
    assignCrew,
    publishSelectedWindow,
    setFailNextWriteFlag,
    resetDraft,
    windowIdOfStep,
    persist,
  }
})
