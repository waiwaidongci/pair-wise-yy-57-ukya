import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { ExecutionRecord, TestCase, TestStep } from './types'
import { seedCases, seedExecutions } from './mock'

const STORAGE_KEY = 'yy57-interlocking-draft-v1'

export const useTestStore = defineStore('interlocking', () => {
  const cases = ref<TestCase[]>(structuredClone(seedCases))
  const executions = ref<ExecutionRecord[]>(structuredClone(seedExecutions))
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
  watch(cases, persist, { deep:true })
  restore()
  return { cases, executions, selectedCaseId, selectedRouteIds, selectedCase, progress, baselineLocked, connection, pendingRetry, liveMessage, changedDevices, affectedCases, selectCase, setStepResult, startExecution, updateLiveProgress, simulateDisconnect, retry, lockBaseline }
})
