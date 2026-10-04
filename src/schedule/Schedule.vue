<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { NButton, NTag, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { useScheduleStore } from './store'
import type { IssueType, ScheduleStep } from './types'

const store = useScheduleStore()
const message = useMessage()

const durationDraft = ref<Record<string, number>>({})

const win = computed(() => store.selectedWindow)
const schedule = computed(() => store.currentSchedule)
const frozen = computed(() => win.value.status === '已下发')
const buckets = computed(() => Math.ceil(win.value.lengthMin / 60))

const placementByStep = computed(() => {
  const map = new Map(schedule.value?.placements.map((p) => [p.stepId, p]) ?? [])
  return map
})

const issueByStep = computed(() => {
  const map = new Map<string, { type: IssueType; reason: string }[]>()
  for (const issue of schedule.value?.issues ?? []) {
    const list = map.get(issue.stepId) ?? []
    list.push({ type: issue.type, reason: issue.reason })
    map.set(issue.stepId, list)
  }
  return map
})

function placement(stepId: string) {
  return placementByStep.value.get(stepId)
}
function issues(stepId: string) {
  return issueByStep.value.get(stepId) ?? []
}
function crewName(id?: string) {
  return id ? store.crewMap.get(id)?.name ?? id : '—'
}
function deviceLabel(id: string) {
  const d = store.deviceMap.get(id)
  return d ? `${d.id} ${d.name}` : id
}
function dependencyLabels(step: ScheduleStep) {
  return step.dependencyIds
    .map((id) => store.steps.find((s) => s.id === id)?.code ?? id)
    .join('、') || '无'
}
function hourLabel(b: number) {
  const start = (win.value.startHour + b) % 24
  return `${String(start).padStart(2, '0')}:00`
}
function fmtTime(min: number) {
  const start = win.value.startHour * 60 + min
  return `${String(Math.floor(start / 60) % 24).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`
}

function tagForIssue(type: IssueType) {
  return h(
    NTag,
    { type: type === '资格不符' ? 'error' : type === '设备重叠' ? 'warning' : type === '旧数据缺班组' ? 'info' : 'default', size: 'small', bordered: false },
    { default: () => type },
  )
}

function submitDuration(step: ScheduleStep) {
  const value = durationDraft.value[step.id] ?? step.durationMin
  const res = store.updateDuration(step.id, value)
  message[res.ok ? 'success' : 'warning'](res.message, { duration: 5000 })
  if (res.ok) delete durationDraft.value[step.id]
}

function onChangeCrew(step: ScheduleStep, crewId: string) {
  const res = store.assignCrew(step.id, crewId)
  message[res.ok ? 'success' : 'error'](res.message, { duration: 5000 })
}

async function doPublish() {
  const res = await store.publishSelectedWindow()
  message[res.ok ? 'success' : 'error'](res.message, { duration: 6000 })
}

const placedCount = computed(() => schedule.value?.placements.length ?? 0)
const issueCount = computed(() => schedule.value?.issues.length ?? 0)
const deviceIssueCount = computed(() => schedule.value?.issues.filter((i) => i.type === '设备重叠').length ?? 0)
const qualIssueCount = computed(() => schedule.value?.issues.filter((i) => i.type === '资格不符').length ?? 0)

const columns = computed<DataTableColumns<ScheduleStep>>(() => [
  {
    title: '步骤', key: 'code', width: 210,
    render: (row) => h('div', { class: 'cell-title' }, [
      h('b', null, `${row.code} ${row.title}`),
      h('small', null, `要求：${row.kind} · ${row.requiredLevel} 级`),
    ]),
  },
  { title: '前置依赖', key: 'dep', width: 110, render: (row) => dependencyLabels(row) },
  { title: '独占设备', key: 'dev', render: (row) => row.deviceIds.map(deviceLabel).join('、') },
  {
    title: '时长/班组', key: 'crew', width: 250,
    render: (row) => h('div', { class: 'cell-edit' }, [
      h('div', { class: 'cell-edit-row' }, [
        h('input', {
          class: 'dur-input',
          value: durationDraft.value[row.id] ?? row.durationMin,
          disabled: frozen.value,
          onChange: (e: Event) => { durationDraft.value[row.id] = Number((e.target as HTMLInputElement).value) },
        }),
        h('span', null, '分钟'),
        h(NButton, {
          size: 'tiny',
          type: 'primary',
          disabled: frozen.value || (durationDraft.value[row.id] ?? row.durationMin) === row.durationMin,
          onClick: () => submitDuration(row),
        }, () => '更新并重算'),
      ]),
      h('select', {
        class: 'crew-select',
        value: row.crewId ?? '',
        disabled: frozen.value,
        onChange: (e: Event) => onChangeCrew(row, (e.target as HTMLSelectElement).value),
      }, store.crewList.map((c) => h('option', { value: c.id }, `${c.name}（${c.qualifications.join('/') || '无资质'} · ${c.level}级）`))),
    ]),
  },
  {
    title: '排程/问题', key: 'status', width: 240,
    render: (row) => {
      const p = placement(row.id)
      if (p) {
        return h('div', { class: 'cell-ok' }, [
          h('b', null, `${fmtTime(p.startMin)}–${fmtTime(p.endMin)}`),
          h('small', null, store.migratedStepIds.includes(row.id) ? '班组由旧数据升级补齐' : '已排入'),
        ])
      }
      return h('div', { class: 'cell-bad' }, issues(row.id).map((i) =>
        h('div', { class: 'bad-line' }, [tagForIssue(i.type), h('small', { title: i.reason }, i.reason)]),
      ))
    },
  },
])
</script>

<template>
  <section class="page-head">
    <div>
      <p class="eyebrow">步骤依赖 · 设备小时段独占 · 班组资格 · 发布门禁</p>
      <h1>天窗动态排程</h1>
      <p>时长更新后，当前天窗内后续步骤自动失效重算；已下发窗口保持冻结。设备重叠或资格不符的步骤集中列出，越权调整他人班组直接拒绝。</p>
    </div>
    <n-space>
      <n-select
        :value="store.selectedWindowId"
        style="width: 250px"
        :options="store.windows.map((w) => ({ label: `${w.name}（${w.status}${w.planNo ? ' · ' + w.planNo : ''}）`, value: w.id }))"
        @update:value="store.selectWindow"
      />
      <n-select
        :value="store.currentUserId"
        style="width: 230px"
        :options="store.usersList.map((u) => ({ label: u.name, value: u.id }))"
        @update:value="store.switchUser"
      />
      <n-button :disabled="frozen" @click="store.resetDraft">重置草稿</n-button>
    </n-space>
  </section>

  <n-alert v-if="frozen" type="info" class="freeze-banner" :bordered="false">
    该天窗已按计划号 <b>{{ win.planNo }}</b> 于 {{ win.publishedAt }} 下发，排程快照只读冻结；任何时长、班组或设备变化都不会回改此窗口。
  </n-alert>

  <div class="metrics">
    <div class="card metric"><span>排程版本 / 重算次数</span><strong>rev-{{ schedule?.revision ?? '—' }}</strong><small>{{ schedule?.recomputedAt }} 更新</small></div>
    <div class="card metric"><span>已排入步骤</span><strong>{{ placedCount }}</strong><small>整点小时段对齐</small></div>
    <div class="card metric"><span>设备重叠</span><strong>{{ deviceIssueCount }}</strong><small>同设备同时段独占冲突</small></div>
    <div class="card metric"><span>资格不符</span><strong>{{ qualIssueCount }}</strong><small>设备资质或作业等级不满足</small></div>
  </div>

  <n-alert
    v-if="schedule?.changeNote"
    type="warning"
    class="freeze-banner"
    title="失效重算记录"
    :bordered="false"
  >
    {{ schedule.changeNote }}（{{ schedule.recomputedAt }}）
  </n-alert>

  <div class="schedule-grid">
    <article class="card">
      <div class="panel-head">
        <div><h2>小时段占用甘特图</h2><p>道岔、轨道区段、信号机按小时段独占；颜色相同代表同一设备争用链</p></div>
        <n-tag :type="frozen ? 'info' : store.currentGate.passed ? 'success' : 'error'">
          {{ frozen ? '已冻结' : store.currentGate.passed ? '门禁通过' : `${issueCount} 项阻断` }}
        </n-tag>
      </div>

      <div class="gantt">
        <div class="gantt-row gantt-head-row">
          <div class="gantt-label">步骤</div>
          <div class="gantt-track" v-for="b in buckets" :key="b">{{ hourLabel(b - 1) }}</div>
        </div>
        <div v-for="step in store.windowSteps" :key="step.id" class="gantt-row">
          <div class="gantt-label" :class="{ blocked: issues(step.id).length }">
            <b>{{ step.code }}</b>
            <small>{{ step.title }}</small>
          </div>
          <div
            v-for="b in buckets"
            :key="b"
            class="gantt-cell"
            :class="{ 'cell-tail': b === buckets }"
          ></div>
          <div class="gantt-overlay">
            <div
              v-if="placement(step.id)"
              class="gantt-bar"
              :class="frozen ? 'bar-frozen' : ''"
              :style="{
                left: `${(placement(step.id)!.startMin / 60 / buckets) * 100}%`,
                width: `${(((placement(step.id)!.endMin - placement(step.id)!.startMin) / 60) / buckets) * 100}%`,
              }"
            >
              <b>{{ step.code }}</b>
              <small>{{ fmtTime(placement(step.id)!.startMin) }}–{{ fmtTime(placement(step.id)!.endMin) }} · {{ crewName(step.crewId) }}</small>
            </div>
            <div v-else class="gantt-bar bar-unplaced" style="left:0;width:100%">
              <b>{{ step.code }} 排不进去</b>
              <small>{{ issues(step.id).map((i) => i.type).join(' / ') }}</small>
            </div>
          </div>
        </div>
      </div>

      <n-divider />

      <h3>步骤明细与动态调整</h3>
      <n-data-table
        :bordered="false"
        size="small"
        :columns="columns"
        :data="store.windowSteps"
        :pagination="false"
      />
    </article>

    <aside class="side-col">
      <article class="card">
        <div class="panel-head">
          <div><h2>发布检查</h2><p>存在排不进去的步骤即阻断下发</p></div>
          <n-tag :type="frozen ? 'info' : store.currentGate.passed ? 'success' : 'error'">{{ frozen ? '已下发' : store.currentGate.passed ? '可下发' : '阻断' }}</n-tag>
        </div>
        <n-result
          v-if="frozen"
          status="success"
          :title="`计划号 ${win.planNo}`"
          :description="`${win.publishedAt} 下发，窗口排程已冻结`"
        />
        <template v-else>
          <div v-if="store.currentGate.blockers.length" class="gate-list">
            <div v-for="(b, i) in store.currentGate.blockers" :key="i" class="gate-item">
              <n-tag :type="b.type === '资格不符' ? 'error' : 'warning'" size="small">{{ b.type }}</n-tag>
              <div><b>{{ store.steps.find((s) => s.id === b.stepId)?.code }}</b><small>{{ b.reason }}</small></div>
            </div>
          </div>
          <n-result v-else status="success" title="门禁全部通过" description="依赖闭环、设备无重叠、班组资格齐备" />

          <n-divider />
          <div class="plan-line" v-if="store.pendingPlanNo[win.id]">
            <n-tag type="warning">待重试计划号</n-tag>
            <b>{{ store.pendingPlanNo[win.id] }}</b>
            <small>写入失败后按此计划号幂等重试，不重新生成</small>
          </div>
          <div class="plan-line" v-else>
            <n-tag type="info">计划号预生成</n-tag>
            <small>下发时生成并锁定，失败重试沿用同一编号</small>
          </div>
          <n-switch :value="store.failNextWrite" @update:value="store.setFailNextWriteFlag">模拟下一次写入失败</n-switch>
          <n-button type="primary" block style="margin-top:10px" :loading="store.publishing" @click="doPublish">
            {{ store.pendingPlanNo[win.id] ? `按计划号 ${store.pendingPlanNo[win.id]} 重试下发` : '发布检查通过后下发窗口' }}
          </n-button>
          <n-alert v-if="store.writeError" type="error" style="margin-top:10px" :title="store.lastGoodKept ? '写入失败，已保留原可执行版本' : '写入异常'" :bordered="false">
            {{ store.writeError }}
          </n-alert>
        </template>
      </article>

      <article class="card">
        <div class="panel-head"><div><h2>排不进去的步骤</h2><p>设备重叠 / 资格不符 / 容量或依赖阻断</p></div><n-tag>{{ issueCount }}</n-tag></div>
        <div v-if="!schedule?.issues.length" class="empty-note">当前天窗所有步骤均可排入。</div>
        <div v-for="(issue, i) in schedule?.issues ?? []" :key="i" class="issue-card">
          <div class="issue-head"><n-tag :type="issue.type === '资格不符' ? 'error' : 'warning'" size="small">{{ issue.type }}</n-tag><b>{{ store.steps.find((s) => s.id === issue.stepId)?.code }} {{ issue.detail }}</b></div>
          <small>{{ issue.reason }}</small>
        </div>
      </article>

      <article class="card">
        <div class="panel-head"><div><h2>权限与旧数据升级日志</h2><p>越权调整他人班组将被拒绝并留痕</p></div></div>
        <div class="audit-list">
          <div v-for="(a, i) in store.audits.slice(0, 12)" :key="i" class="audit-line" :class="a.level">
            <n-tag :type="a.level === 'error' ? 'error' : a.level === 'warn' ? 'warning' : 'default'" size="tiny">{{ a.level === 'info' ? '记录' : a.level === 'warn' ? '拒绝' : '失败' }}</n-tag>
            <div><small>{{ a.at }}</small><p>{{ a.message }}</p></div>
          </div>
          <div v-if="!store.audits.length" class="empty-note">操作、拒绝与升级记录将显示在这里。</div>
        </div>
      </article>
    </aside>
  </div>
</template>

<style scoped>
.freeze-banner { margin-bottom: 14px; }
.schedule-grid { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(330px, .72fr); gap: 16px; align-items: start; }
.side-col { display: flex; flex-direction: column; gap: 16px; }
.gantt { border: 1px solid #e7ebf1; border-radius: 6px; overflow: hidden; }
.gantt-row { position: relative; display: grid; grid-template-columns: 190px repeat(auto-fit, minmax(0, 1fr)); min-height: 42px; border-bottom: 1px solid #edf0f5; }
.gantt-row:last-child { border-bottom: 0; }
.gantt-head-row { min-height: 34px; background: #f8fafc; color: #64748b; font-size: 12px; }
.gantt-head-row .gantt-track { display: grid; place-items: center; border-left: 1px solid #edf0f5; }
.gantt-label { padding: 6px 10px; border-right: 1px solid #edf0f5; display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.gantt-label b { font-size: 12px; }
.gantt-label small { color: #7a8798; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gantt-label.blocked b { color: #d03050; }
.gantt-cell { border-left: 1px dashed #eef1f5; }
.gantt-overlay { position: absolute; top: 0; bottom: 0; left: 190px; right: 0; }
.gantt-bar { position: absolute; top: 5px; height: calc(100% - 10px); background: #dbeafe; border: 1px solid #2563eb; border-radius: 5px; padding: 3px 8px; overflow: hidden; display: flex; flex-direction: column; justify-content: center; box-sizing: border-box; }
.gantt-bar b { font-size: 11px; color: #1d4ed8; }
.gantt-bar small { font-size: 10px; color: #1e40af; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gantt-bar.bar-frozen { background: #e2e8f0; border-color: #94a3b8; }
.gantt-bar.bar-frozen b, .gantt-bar.bar-frozen small { color: #475569; }
.gantt-bar.bar-unplaced { background: repeating-linear-gradient(45deg, #fff1f2, #fff1f2 6px, #ffe4e6 6px, #ffe4e6 12px); border: 1px dashed #e11d48; }
.gantt-bar.bar-unplaced b { color: #be123c; }
.gantt-bar.bar-unplaced small { color: #be123c; }
.cell-title { display: flex; flex-direction: column; gap: 2px; }
.cell-title small { color: #7a8798; }
.cell-edit { display: flex; flex-direction: column; gap: 6px; }
.cell-edit-row { display: flex; align-items: center; gap: 6px; }
.dur-input { width: 64px; padding: 3px 6px; border: 1px solid #d0d5dd; border-radius: 4px; }
.crew-select { width: 100%; padding: 3px 4px; border: 1px solid #d0d5dd; border-radius: 4px; font-size: 12px; }
.cell-ok { display: flex; flex-direction: column; gap: 2px; }
.cell-ok small { color: #0f9960; }
.cell-bad { display: flex; flex-direction: column; gap: 4px; }
.bad-line { display: flex; align-items: flex-start; gap: 6px; }
.bad-line small { color: #b42318; line-height: 1.35; }
.gate-list { display: flex; flex-direction: column; gap: 10px; }
.gate-item { display: flex; gap: 8px; align-items: flex-start; padding: 8px; background: #fff7f7; border: 1px solid #fecdd3; border-radius: 6px; }
.gate-item b, .gate-item small { display: block; }
.gate-item small { color: #b42318; margin-top: 2px; line-height: 1.4; }
.plan-line { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.plan-line small { color: #7a8798; }
.issue-card { padding: 10px 0; border-bottom: 1px solid #edf0f5; }
.issue-card:last-child { border-bottom: 0; }
.issue-head { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
.issue-head b { font-size: 13px; }
.issue-card small { color: #b42318; line-height: 1.5; }
.empty-note { color: #7a8798; font-size: 13px; padding: 8px 0; }
.audit-list { display: flex; flex-direction: column; gap: 10px; max-height: 320px; overflow: auto; }
.audit-line { display: flex; gap: 8px; align-items: flex-start; }
.audit-line small { color: #98a2b3; }
.audit-line p { margin: 2px 0 0; font-size: 12px; line-height: 1.5; color: #475569; }
.audit-line.warn p { color: #b45309; }
.audit-line.error p { color: #b42318; }
@media (max-width: 1200px) { .schedule-grid { grid-template-columns: 1fr; } }
</style>
