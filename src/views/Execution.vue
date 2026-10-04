<script setup lang="ts">
import { ref } from 'vue'
import { useTestStore } from '../store'

const store = useTestStore()
const failureReason = ref('模拟 3G 占用后，S2 信号未立即关闭，联锁日志出现 126ms 延迟')
const evidence = ref('录屏 VID-021、联锁日志 LG-144、CS-LEU-09 设备快照')

function failStep() {
  const item = store.selectedCase
  const step = item?.steps.find((entry) => entry.result === '未执行')
  if (item && step && failureReason.value.trim()) store.setStepResult(item.id, step.id, '失败', failureReason.value)
}
function passStep() {
  const item = store.selectedCase
  const step = item?.steps.find((entry) => entry.result === '未执行')
  if (item && step) store.setStepResult(item.id, step.id, '通过', '预期结果一致，证据已归档')
}
function simulateDisconnect() { store.simulateDisconnect() }
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">实时执行与证据</p><h1>回归执行记录</h1><p>每次执行关联设备快照、证据附件和失败原因；未通过用例不能无痕跳过。</p></div><n-space><n-button @click="simulateDisconnect">模拟断线</n-button><n-button type="success" @click="passStep">记录通过</n-button><n-button type="error" @click="failStep">记录失败</n-button></n-space></section>
  <div class="execution-grid"><article class="card"><div class="panel-head"><div><h2>{{store.selectedCase?.id}} 执行面板</h2><p>{{store.selectedCase?.name}}</p></div><n-tag :type="store.connection==='在线'?'success':'warning'">{{store.connection}} · {{store.liveMessage}}</n-tag></div><n-progress type="line" :percentage="store.progress" :height="12" /><div v-for="step in store.selectedCase?.steps" :key="step.id" class="execute-step" :class="step.result"><div><b>{{step.id}} · {{step.action}}</b><small>预期：{{step.expected}}</small><small v-if="step.actual">实测：{{step.actual}}</small></div><n-tag :type="step.result==='通过'?'success':step.result==='失败'?'error':'info'">{{step.result}}</n-tag></div><n-form label-placement="top"><n-form-item label="失败原因与设备快照"><n-input v-model:value="failureReason" type="textarea" :rows="3" /></n-form-item><n-form-item label="证据附件"><n-input v-model:value="evidence" /></n-form-item></n-form></article>
    <aside class="card"><div class="panel-head"><div><h2>执行历史</h2><p>失败与重测记录不可覆盖</p></div></div><n-timeline><n-timeline-item v-for="record in store.executions" :key="record.id" :type="record.result==='通过'?'success':record.result==='失败'?'error':'info'" :title="`${record.caseId} · ${record.result}`" :content="`${record.operator} ${record.startedAt}${record.finishedAt ? ' → '+record.finishedAt : ''}\n${record.snapshot}\n证据：${record.evidence.join('、') || '采集中'}`" /></n-timeline><n-button block>导出执行报告</n-button></aside></div>
</template>
