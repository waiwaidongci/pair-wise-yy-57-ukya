<script setup lang="ts">
import { computed } from 'vue'
import { useTestStore } from '../store'

const store = useTestStore()
const ready = computed(() => store.cases.every((item) => item.status === '通过'))
function exportPackage() {
  const report = { station:'海州站 CS', version:'v26.10', locked:store.baselineLocked, cases:store.cases.map((item)=>({id:item.id,name:item.name,status:item.status,steps:item.steps.length,failureReason:item.failureReason})), executions:store.executions, generatedAt:new Date().toISOString() }
  const blob = new Blob([JSON.stringify(report,null,2)],{type:'application/json'})
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download='联锁测试报告-v26.10.json'; link.click(); URL.revokeObjectURL(link.href)
}
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">发布门禁与历史基线</p><h1>基线锁定与测试报告</h1><p>全部未通过、阻塞和证据缺失项闭环后，才能锁定版本并导出可追溯测试报告。</p></div><n-space><n-button @click="exportPackage">导出测试报告</n-button><n-button type="primary" :disabled="!ready || store.baselineLocked" @click="store.lockBaseline">锁定发布基线</n-button></n-space></section>
  <n-alert :type="ready ? 'success' : 'error'" :title="ready ? '全部用例已通过，可锁定' : '发布门禁未通过'" :description="ready ? '设备快照、执行证据和失败闭环均完整。' : '存在失败、阻塞或未执行步骤，任何人员不得无痕跳过。'" style="margin-bottom:16px" />
  <div class="grid-2"><article class="card"><div class="panel-head"><div><h2>发布门禁清单</h2><p>自动判断，不允许人工绕过</p></div><n-tag :type="ready?'success':'error'">{{ready?'可发布':'阻断'}}</n-tag></div><div v-for="item in store.cases" :key="item.id" class="gate"><div><b>{{item.id}} · {{item.name}}</b><small>{{item.failureReason || '执行记录完整'}}</small></div><n-tag :type="item.status==='通过'?'success':item.status==='失败'?'error':'warning'">{{item.status}}</n-tag></div></article>
    <article class="card"><div class="panel-head"><div><h2>差异与影响范围</h2><p>v26.09 → v26.10</p></div><n-tag>2 项设备变更</n-tag></div><div class="diff"><b>P-02 转辙机更换</b><p>影响 R-01、R-02、R-03；新增转辙机动作时序与锁闭反馈差异。</p></div><div class="diff"><b>T-03 绝缘节调整</b><p>影响 R-02、R-04；轨道区段占用边界和信号关闭时机需重测。</p></div><n-divider /><h3>基线状态</h3><n-result :status="store.baselineLocked ? 'success' : 'info'" :title="store.baselineLocked ? 'v26.10 已锁定' : '等待全部用例通过'" :description="store.baselineLocked ? '报告与证据哈希已签章。' : '锁定后生成只读版本快照。'" /></article></div>
</template>
