<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTestStore } from '../store'

const store = useTestStore()
const view = ref<'草稿' | '已下发'>('草稿')
const modalOpen = ref(false)
const modalStep = ref<{ caseId: string; stepId: string } | null>(null)
const form = ref({ windowId: '', startHour: 14, teamId: '' })

const currentMember = computed(() => store.members.find((item) => item.id === store.currentUserId))
const shownWindows = computed(() => store.windows.filter((item) => item.status === view.value))
const hourMin = computed(() => Math.min(...store.windows.map((item) => item.startHour)))
const hourMax = computed(() => Math.max(...store.windows.map((item) => item.endHour)))
const hours = computed(() => Array.from({ length: hourMax.value - hourMin.value }, (_, index) => hourMin.value + index))
const assignedCount = computed(() => store.assignments.filter((item) => item.status === '已排').length)

function assignmentAt(windowId: string, hour: number) {
  return store.assignments.find((item) => item.windowId === windowId && item.startHour <= hour && hour < item.endHour)
}
function openAssign(caseId: string, stepId: string) {
  modalStep.value = { caseId, stepId }
  form.value = { windowId: store.draftWindows[0]?.id ?? '', startHour: store.draftWindows[0]?.startHour ?? 14, teamId: '' }
  modalOpen.value = true
}
function submitAssign() {
  if (!modalStep.value || !form.value.teamId) return
  store.manualAssign(modalStep.value.caseId, modalStep.value.stepId, form.value.windowId, form.value.startHour, form.value.teamId)
  modalOpen.value = false
}
function stepOf(stepId: string) {
  for (const caseItem of store.cases) {
    const step = caseItem.steps.find((item) => item.id === stepId)
    if (step) return step
  }
  return undefined
}
function teamName(teamId: string) { return store.teams.find((item) => item.id === teamId)?.name ?? teamId }
function windowHourOptions(windowId: string) {
  const win = store.windows.find((item) => item.id === windowId)
  if (!win) return []
  return Array.from({ length: win.endHour - win.startHour }, (_, index) => ({ label: `${win.startHour + index}:00`, value: win.startHour + index }))
}
</script>

<template>
  <section class="page-head">
    <div>
      <p class="eyebrow">步骤依赖 · 设备独占 · 班组资质 · 发布检查</p>
      <h1>检修排班动态排程</h1>
      <p>步骤按依赖顺序排入天窗，道岔/信号机/轨道区段按小时段独占，资质不符不得排入；时长变更后当前天窗后续步骤失效重算，已下发窗口冻结不动。</p>
    </div>
    <n-space align="center">
      <n-tag type="info">{{ currentMember?.name }} · {{ teamName(currentMember?.teamId ?? '') }} 班组长</n-tag>
      <n-switch v-model:value="store.forceWriteFailure">模拟写入失败</n-switch>
      <n-button @click="store.recomputeDrafts">全部重算</n-button>
    </n-space>
  </section>

  <n-alert v-if="store.scheduleMessage" type="info" :title="store.scheduleMessage" style="margin-bottom:14px" />

  <div class="metrics">
    <article class="card metric"><span>草稿天窗</span><strong>{{ store.draftWindows.length }}</strong><small>可排程、可重算</small></article>
    <article class="card metric"><span>已下发天窗</span><strong>{{ store.issuedWindows.length }}</strong><small>冻结不动</small></article>
    <article class="card metric"><span>已排步骤</span><strong>{{ assignedCount }}</strong><small>按小时段独占</small></article>
    <article class="card metric"><span>无法排程</span><strong>{{ store.conflicts.length }}</strong><small>见右侧冲突清单</small></article>
  </div>

  <div class="sched-grid">
    <article class="card">
      <div class="panel-head">
        <div><h2>天窗排程甘特</h2><p>点击步骤块改派；时长变更后后续步骤失效重算</p></div>
        <n-radio-group v-model:value="view" size="small">
          <n-radio-button value="草稿">草稿天窗</n-radio-button>
          <n-radio-button value="已下发">已下发天窗</n-radio-button>
        </n-radio-group>
      </div>
      <div v-for="win in shownWindows" :key="win.id" class="gantt-row">
        <div class="gantt-head">
          <b>{{ win.name }}</b>
          <small>{{ win.date }} · {{ win.planId }} · {{ win.startHour }}:00-{{ win.endHour }}:00</small>
          <n-tag :type="win.status === '已下发' ? 'success' : 'warning'" size="small">{{ win.status }}</n-tag>
          <n-button v-if="win.status === '草稿'" size="tiny" type="primary" @click="store.issueWindow(win.planId)">下发</n-button>
        </div>
        <div class="gantt-hours">
          <div v-for="hour in hours" :key="hour" class="gantt-cell">
            <span class="hour-label">{{ hour }}:00</span>
            <template v-for="asgn in [assignmentAt(win.id, hour)]" :key="asgn ? asgn.stepId : 'empty'">
              <div v-if="asgn" class="asgn-block" :class="{ invalid: asgn.status === '失效', pinned: asgn.pinned }" @click="win.status === '草稿' && openAssign(asgn.caseId, asgn.stepId)">
                <b>{{ asgn.stepId }}</b>
                <small>{{ asgn.teamId }} · {{ asgn.assigneeName }}</small>
                <n-input-number
                  v-if="win.status === '草稿'"
                  size="tiny"
                  :min="1"
                  :max="4"
                  :value="stepOf(asgn.stepId)?.durationHours ?? 1"
                  @update:value="(value: number | null) => { if (value != null) store.updateStepDuration(asgn.caseId, asgn.stepId, value) }"
                  @click.stop
                />
              </div>
            </template>
          </div>
        </div>
      </div>
      <n-empty v-if="!shownWindows.length" :description="`无${view}天窗`" />
    </article>

    <aside class="sched-side">
      <article class="card">
        <div class="panel-head"><div><h2>无法排程清单</h2><p>设备重叠 / 资质不符 / 窗口不足</p></div><n-tag type="error">{{ store.conflicts.length }}</n-tag></div>
        <div v-for="item in store.conflicts" :key="item.stepId" class="conflict">
          <div><b>{{ item.stepId }}</b><small>{{ store.cases.find((c) => c.id === item.caseId)?.name }}</small></div>
          <ul><li v-for="reason in item.reasons" :key="reason">{{ reason }}</li></ul>
        </div>
        <n-empty v-if="!store.conflicts.length" description="全部步骤已排入天窗" size="small" />
      </article>

      <article class="card">
        <div class="panel-head"><div><h2>计划写入状态</h2><p>失败后保留可执行版本，按计划号重试</p></div></div>
        <div v-for="win in store.windows" :key="win.id" class="write-row">
          <div><b>{{ win.planId }}</b><small>{{ win.name }} · 重试 {{ store.writeStates[win.planId]?.retryCount ?? 0 }} 次</small><small v-if="store.writeStates[win.planId]?.lastError">错误：{{ store.writeStates[win.planId]?.lastError }}</small></div>
          <n-space>
            <n-tag :type="store.writeStates[win.planId]?.status === '已写入' ? 'success' : 'error'" size="small">{{ store.writeStates[win.planId]?.status ?? '已写入' }}</n-tag>
            <n-button v-if="store.writeStates[win.planId]?.status === '写入失败'" size="tiny" type="warning" @click="store.retryPlan(win.planId)">按计划号重试</n-button>
          </n-space>
        </div>
      </article>

      <article class="card">
        <div class="panel-head"><div><h2>旧数据升级记录</h2><p>缺班组编号 / 时长 / 资质时补齐来源</p></div><n-tag type="info">{{ store.migrations.length }}</n-tag></div>
        <div v-for="(record, index) in store.migrations" :key="index" class="migration">
          <b>{{ record.caseId }}{{ record.stepId ? ' · ' + record.stepId : '' }}{{ record.windowId ? ' · ' + record.windowId : '' }}</b>
          <small>补齐 {{ record.field }} = {{ record.filled }}</small>
          <small class="source">来源：{{ record.source }}</small>
        </div>
        <n-empty v-if="!store.migrations.length" description="无旧数据升级" size="small" />
      </article>
    </aside>
  </div>

  <n-modal v-model:show="modalOpen" title="改派步骤到天窗" style="width:480px">
    <n-form label-placement="top">
      <n-form-item label="步骤">{{ modalStep?.stepId }} · {{ stepOf(modalStep?.stepId ?? '')?.action }}</n-form-item>
      <n-form-item label="天窗">
        <n-select v-model:value="form.windowId" :options="store.draftWindows.map((win) => ({ label: `${win.name}（${win.date} ${win.startHour}:00-${win.endHour}:00）`, value: win.id }))" />
      </n-form-item>
      <n-form-item label="开始小时段">
        <n-select v-model:value="form.startHour" :options="windowHourOptions(form.windowId)" />
      </n-form-item>
      <n-form-item label="班组">
        <n-select v-model:value="form.teamId" :options="store.teams.map((team) => ({ label: `${team.name}（${team.leaderName}）${store.canManageTeam(team.id) ? '' : ' · 无权调整'}`, value: team.id, disabled: !store.canManageTeam(team.id) }))" />
      </n-form-item>
    </n-form>
    <n-space justify="end">
      <n-button @click="modalOpen = false">取消</n-button>
      <n-button type="primary" @click="submitAssign">改派</n-button>
    </n-space>
  </n-modal>
</template>
