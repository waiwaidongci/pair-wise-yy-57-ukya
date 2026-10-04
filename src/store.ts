import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { ExecutionRecord, MigrationRecord, PlanWriteState, ScheduleAssignment, ScheduleConflict, TestCase, TestStep } from './types'
import { members as seedMembers, seedAssignments, seedCases, seedExecutions, teams as seedTeams, windows as seedWindows } from './mock'
import { deriveQualifications, findStep as findStepInCases, recomputeDraftSchedule, resolveDeviceIds, resolveQualifications, teamCovers, tryPlaceStep } from './scheduling'

const STORAGE_KEY = 'yy57-interlocking-draft-v1'
const SCHEDULE_KEY = 'yy57-interlocking-schedule-v1'

/** 深拷贝（排班数据均为纯 JSON，兼容响应式 Proxy） */
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) }

export const useTestStore = defineStore('interlocking', () => {
  const cases = ref<TestCase[]>(clone(seedCases))
  const executions = ref<ExecutionRecord[]>(clone(seedExecutions))
  const selectedCaseId = ref('TC-102')
  const selectedRouteIds = ref<string[]>(['R-02'])
  const baselineLocked = ref(false)
  const connection = ref<'在线' | '重连中'>('在线')
  const pendingRetry = ref(0)
  const liveMessage = ref('执行进度已同步')
  const selectedCase = computed(() => cases.value.find((item) => item.id === selectedCaseId.value))
  const progress = computed(() => {
    const steps = cases.value.flatMap((item) => item.steps)
    return Math.round(steps.filter((step) => step.result !== '未执行').length / steps.length * 100)
  })
  const changedDevices = ['P-02 转辙机更换', 'T-03 绝缘节调整']
  const affectedCases = computed(() => cases.value.filter((item) => item.routeIds.some((routeId) => ['R-02','R-04'].includes(routeId))))

  // ===== 检修排班动态排程 =====
  const teams = ref(clone(seedTeams))
  const members = ref(clone(seedMembers))
  const windows = ref(clone(seedWindows))
  const assignments = ref<ScheduleAssignment[]>(clone(seedAssignments))
  const conflicts = ref<ScheduleConflict[]>([])
  const writeStates = ref<Record<string, PlanWriteState>>({})
  const migrations = ref<MigrationRecord[]>([])
  const currentUserId = ref('U-01') // 郑凯，信号检修一班班组长
  const forceWriteFailure = ref(false)
  const scheduleMessage = ref('')
  const executableSnapshots = ref<Record<string, ScheduleAssignment[]>>({})

  const currentMember = computed(() => members.value.find((item) => item.id === currentUserId.value))
  const ledTeamIds = computed(() => teams.value.filter((item) => item.leaderId === currentUserId.value).map((item) => item.id))
  const draftWindows = computed(() => windows.value.filter((item) => item.status === '草稿'))
  const issuedWindows = computed(() => windows.value.filter((item) => item.status === '已下发'))

  function canManageTeam(teamId: string): boolean { return ledTeamIds.value.includes(teamId) }

  function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify({ cases: cases.value, executions: executions.value })) }
  function restore() { const raw = localStorage.getItem(STORAGE_KEY); if (raw) { const draft = JSON.parse(raw); cases.value = draft.cases; executions.value = draft.executions } }
  function selectCase(id: string) { selectedCaseId.value = id; selectedRouteIds.value = cases.value.find((item) => item.id === id)?.routeIds ?? [] }
  function setStepResult(caseId: string, stepId: string, result: TestStep['result'], actual?: string) {
    if (baselineLocked.value) return
    const item = cases.value.find((entry) => entry.id === caseId)
    const step = item?.steps.find((entry) => entry.id === stepId)
    if (!item || !step) return
    if (step.dependency && item.steps.find((entry) => entry.id === step.dependency)?.result !== '通过') {
      liveMessage.value = `前置步骤 ${step.dependency} 未通过，禁止跳过`
      return
    }
    step.result = result
    step.actual = actual ?? step.actual
    item.status = item.steps.some((entry) => entry.result === '失败') ? '失败' : item.steps.every((entry) => entry.result === '通过') ? '通过' : '执行中'
    persist()
  }
  function startExecution() {
    const item = selectedCase.value
    if (!item) return
    item.status = '执行中'
    executions.value.unshift({ id:`EX-${Date.now().toString().slice(-6)}`, caseId:item.id, operator:'当前用户', startedAt:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}), snapshot:'v26.10 / CS-LEU-09', result:'执行中', evidence:[] })
    persist()
  }
  function updateLiveProgress(value: number) { liveMessage.value = value >= 100 ? '全部用例执行完成，等待审核锁定' : `实时同步：已完成 ${value}%`; if (value >= 100) { const active = executions.value.find((item) => item.result === '执行中'); if (active) { active.result = '失败'; active.finishedAt = new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}) } } }
  function simulateDisconnect() { connection.value = '重连中'; pendingRetry.value += 1 }
  function retry() { connection.value = '在线'; pendingRetry.value = 0; liveMessage.value = '断线期间执行记录已补传' }
  function lockBaseline() { baselineLocked.value = true }

  // ===== 排班动态排程 =====
  function persistSchedule() {
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify({
      windows: windows.value,
      assignments: assignments.value,
      writeStates: writeStates.value,
      migrations: migrations.value,
      conflicts: conflicts.value,
      executable: executableSnapshots.value,
    }))
  }
  function restoreSchedule(): boolean {
    const raw = localStorage.getItem(SCHEDULE_KEY)
    if (!raw) return false
    try {
      const data = JSON.parse(raw)
      if (data.windows) windows.value = data.windows
      if (data.assignments) assignments.value = data.assignments
      if (data.writeStates) writeStates.value = data.writeStates
      if (data.migrations) migrations.value = data.migrations
      if (data.conflicts) conflicts.value = data.conflicts
      if (data.executable) executableSnapshots.value = data.executable
      return true
    } catch { return false }
  }

  /** 旧数据升级：补齐时长、设备、资质、班组、计划号，并记录来源 */
  function runMigration() {
    const now = new Date().toISOString()
    cases.value.forEach((caseItem) => {
      caseItem.steps.forEach((step) => {
        if (step.durationHours == null) {
          step.durationHours = 1
          migrations.value.push({ caseId: caseItem.id, stepId: step.id, field: 'durationHours', source: 'legacy-upgrade', filled: '1 小时', at: now })
        }
        if (!step.deviceIds?.length) {
          step.deviceIds = resolveDeviceIds(step, caseItem)
          migrations.value.push({ caseId: caseItem.id, stepId: step.id, field: 'deviceIds', source: 'legacy-upgrade', filled: step.deviceIds.join('、'), at: now })
        }
        if (!step.requiredQualifications?.length) {
          step.requiredQualifications = deriveQualifications(step.deviceIds ?? resolveDeviceIds(step, caseItem))
          migrations.value.push({ caseId: caseItem.id, stepId: step.id, field: 'requiredQualifications', source: 'legacy-upgrade', filled: step.requiredQualifications.join('、'), at: now })
        }
        if (!step.teamId) {
          const quals = resolveQualifications(step, step.deviceIds ?? resolveDeviceIds(step, caseItem))
          const team = teams.value.find((item) => teamCovers(item, members.value, quals))
          if (team) {
            step.teamId = team.id
            migrations.value.push({ caseId: caseItem.id, stepId: step.id, field: 'teamId', source: 'legacy-upgrade', filled: `${team.id} ${team.name}`, at: now })
          }
        }
      })
    })
    windows.value.forEach((win) => {
      if (!win.planId) {
        win.planId = `JH-legacy-${win.id}`
        migrations.value.push({ caseId: '', windowId: win.id, field: 'planId', source: 'legacy-upgrade', filled: win.planId, at: now })
      }
    })
  }

  function refreshInvalid() {
    assignments.value.forEach((item) => {
      const win = windows.value.find((w) => w.id === item.windowId)
      if (win?.status !== '草稿') return
      const found = findStepInCases(cases.value, item.stepId)
      if (!found?.step.dependency) { item.status = '已排'; return }
      const dep = assignments.value.find((a) => a.stepId === found.step.dependency && a.status === '已排')
      item.status = dep ? '已排' : '失效'
    })
  }

  /** 重算草稿天窗排程：已下发窗口不动，人工固定保留，排不进去的进冲突清单 */
  function recomputeDrafts() {
    const ctx = { windows: windows.value, cases: cases.value, teams: teams.value, members: members.value, assignments: assignments.value }
    const pinned = assignments.value.filter((item) => {
      const win = windows.value.find((w) => w.id === item.windowId)
      return win?.status === '草稿' && item.pinned
    })
    const result = recomputeDraftSchedule(ctx, pinned)
    assignments.value = result.assignments
    conflicts.value = result.conflicts
    refreshInvalid()
    persistSchedule()
  }

  function markDownstreamInvalid(stepId: string) {
    const downstream = new Set<string>()
    function collect(id: string) {
      cases.value.forEach((caseItem) => caseItem.steps.forEach((step) => {
        if (step.dependency === id && !downstream.has(step.id)) { downstream.add(step.id); collect(step.id) }
      }))
    }
    collect(stepId)
    assignments.value.forEach((item) => {
      if (downstream.has(item.stepId)) {
        const win = windows.value.find((w) => w.id === item.windowId)
        if (win?.status === '草稿') { item.status = '失效'; item.pinned = false }
      }
    })
  }

  /** 时长更新：当前天窗内后续步骤失效重算；已下发窗口不动；越权调整他人班组拒绝 */
  function updateStepDuration(caseId: string, stepId: string, hours: number) {
    const found = findStepInCases(cases.value, stepId)
    if (!found) return
    const current = assignments.value.find((item) => item.stepId === stepId)
    if (current && !canManageTeam(current.teamId)) {
      scheduleMessage.value = `越权拒绝：您不是 ${current.teamName} 负责人，无权调整他人班组排程`
      return
    }
    found.step.durationHours = hours
    markDownstreamInvalid(stepId)
    const durationMsg = `步骤 ${stepId} 时长更新为 ${hours} 小时，当前天窗后续步骤已失效重算`
    recomputeDrafts()
    draftWindows.value.forEach((win) => commitPlan(win.planId))
    scheduleMessage.value = durationMsg
  }

  /** 人工改派：调出与调入班组均需本人负责；资质不符拒绝；设备重叠拒绝 */
  function manualAssign(caseId: string, stepId: string, windowId: string, startHour: number, teamId: string) {
    const found = findStepInCases(cases.value, stepId)
    if (!found) return
    const win = windows.value.find((w) => w.id === windowId)
    if (!win || win.status !== '草稿') {
      scheduleMessage.value = '已下发天窗排程冻结，不可调整'
      return
    }
    const current = assignments.value.find((item) => item.stepId === stepId)
    if (current && !canManageTeam(current.teamId)) {
      scheduleMessage.value = `越权拒绝：您不是 ${current.teamName} 负责人，无权调出他人班组`
      return
    }
    if (!canManageTeam(teamId)) {
      scheduleMessage.value = `越权拒绝：您不是 ${teams.value.find((t) => t.id === teamId)?.name} 负责人，无权改派该班组`
      return
    }
    const quals = resolveQualifications(found.step, resolveDeviceIds(found.step, found.caseItem))
    const team = teams.value.find((t) => t.id === teamId)!
    if (!teamCovers(team, members.value, quals)) {
      const missing = quals.filter((qual) => !members.value.some((member) => member.teamId === teamId && member.qualifications.includes(qual)))
      scheduleMessage.value = `资质不符：${team.name} 缺少 ${missing.join('、')}，不得排入 ${stepId}`
      return
    }
    const ctx = { windows: windows.value, cases: cases.value, teams: teams.value, members: members.value, assignments: assignments.value.filter((item) => item.stepId !== stepId) }
    const result = tryPlaceStep(found.step, ctx, { windowId, startHour, teamId })
    if (!result.ok || !result.assignment) {
      scheduleMessage.value = `步骤 ${stepId} 无法排入：${result.reasons.join('；')}`
      return
    }
    assignments.value = assignments.value.filter((item) => item.stepId !== stepId)
    assignments.value.push({ ...result.assignment, pinned: true })
    markDownstreamInvalid(stepId)
    scheduleMessage.value = `步骤 ${stepId} 已改派至 ${win.name} ${startHour}:00-${result.assignment.endHour}:00（${team.name}），后续步骤重算`
    recomputeDrafts()
    commitPlan(win.planId)
  }

  /** 按计划号写入：失败则回滚上一可执行版本，保留现场供重试 */
  function commitPlan(planId: string) {
    const state = writeStates.value[planId]
    if (!state) return
    const win = windows.value.find((w) => w.planId === planId)
    if (!win || win.status !== '草稿') return
    const payload = assignments.value.filter((item) => item.planId === planId)
    state.lastAttemptAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    if (forceWriteFailure.value) {
      forceWriteFailure.value = false
      state.status = '写入失败'
      state.retryCount += 1
      state.lastError = '联锁排程服务写入冲突（计划版本号不匹配），已保留上一可执行版本'
      assignments.value = assignments.value.filter((item) => item.planId !== planId).concat(clone(executableSnapshots.value[planId] ?? []))
      recomputeDrafts()
      scheduleMessage.value = `计划号 ${planId} 写入失败，已回滚到上一可执行版本，可按计划号重试（第 ${state.retryCount} 次）`
    } else {
      state.status = '已写入'
      state.lastError = undefined
      executableSnapshots.value[planId] = clone(payload)
      scheduleMessage.value = `计划号 ${planId} 写入成功，排程已生效`
    }
    refreshInvalid()
    persistSchedule()
  }

  /** 按计划号重试写入 */
  function retryPlan(planId: string) {
    const state = writeStates.value[planId]
    if (!state || state.status !== '写入失败') return
    scheduleMessage.value = `计划号 ${planId} 第 ${state.retryCount + 1} 次重试写入…`
    commitPlan(planId)
  }

  /** 下发天窗：发布检查通过（无冲突、无写入失败）才冻结 */
  function issueWindow(planId: string) {
    const win = windows.value.find((w) => w.planId === planId)
    if (!win || win.status !== '草稿') return
    if (conflicts.value.length) {
      scheduleMessage.value = `发布检查未通过：${conflicts.value.map((item) => item.stepId).join('、')} 无法排程，天窗不得下发`
      return
    }
    if (writeStates.value[planId]?.status === '写入失败') {
      scheduleMessage.value = `发布检查未通过：计划号 ${planId} 写入失败未闭环`
      return
    }
    win.status = '已下发'
    assignments.value.forEach((item) => { if (item.planId === planId) { item.pinned = false; item.status = '已排' } })
    scheduleMessage.value = `天窗「${win.name}」已下发，排程冻结不再变动`
    persistSchedule()
  }

  watch(cases, persist, { deep: true })
  restore()

  const scheduleRestored = restoreSchedule()
  if (!scheduleRestored) {
    runMigration()
    windows.value.forEach((win) => {
      writeStates.value[win.planId] = { planId: win.planId, windowId: win.id, status: '已写入', retryCount: 0 }
      executableSnapshots.value[win.planId] = clone(assignments.value.filter((item) => item.planId === win.planId))
    })
    recomputeDrafts()
    persistSchedule()
  }
  return { cases, executions, selectedCaseId, selectedRouteIds, selectedCase, progress, baselineLocked, connection, pendingRetry, liveMessage, changedDevices, affectedCases, selectCase, setStepResult, startExecution, updateLiveProgress, simulateDisconnect, retry, lockBaseline,
    teams, members, windows, assignments, conflicts, writeStates, migrations, currentUserId, currentMember, ledTeamIds, draftWindows, issuedWindows, forceWriteFailure, scheduleMessage,
    canManageTeam, recomputeDrafts, updateStepDuration, manualAssign, commitPlan, retryPlan, issueWindow }
})
