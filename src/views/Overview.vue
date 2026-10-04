<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { fetchStation } from '../api'
import { useTestStore } from '../store'
import { useExecutionSocket } from '../realtime'

const store = useTestStore()
const { data, isPending } = useQuery({ queryKey:['station'], queryFn:fetchStation })
useExecutionSocket((value) => store.updateLiveProgress(value), (state) => { store.connection = state })
const stats = computed(() => [
  { label:'测试用例', value:store.cases.length, note:'关联 4 条基本进路' },
  { label:'执行进度', value:`${store.progress}%`, note:'实时同步正常' },
  { label:'失败 / 阻塞', value:store.cases.filter((item)=>['失败','阻塞'].includes(item.status)).length, note:'发布前必须闭环' },
  { label:'受影响回归范围', value:store.affectedCases.length, note:'设备变更自动推导' },
])
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">版本升级与回归范围</p><h1>联锁测试回归总览</h1><p>根据道岔、信号机、轨道区段和进路关系，识别受影响用例并串联执行证据。</p></div><n-button type="primary" @click="$router.push('/station')">查看站场受影响区域</n-button></section>
  <n-spin :show="isPending">
    <div class="metrics"><article v-for="item in stats" :key="item.label" class="card metric"><span>{{item.label}}</span><strong>{{item.value}}</strong><small>{{item.note}}</small></article></div>
    <div class="grid-2"><article class="card"><div class="panel-head"><div><h2>本轮变更影响</h2><p>基于设备关系图自动计算</p></div><n-tag type="warning">{{data?.version}}</n-tag></div><div v-for="change in store.changedDevices" :key="change" class="change"><n-tag type="error">设备变更</n-tag><div><b>{{change}}</b><small>影响 {{store.affectedCases.length}} 条用例 · 需执行失败路径与敌对互锁</small></div></div><n-alert type="warning" title="回归范围不能缩减" description="P-02 与 T-03 变更具有跨进路影响，只有版本控制负责人可审批范围例外。" /></article>
    <article class="card"><div class="panel-head"><div><h2>执行状态</h2><p>按用例和失败步骤汇总</p></div><n-tag>{{store.progress}}%</n-tag></div><n-progress type="line" :percentage="store.progress" :height="12" /><div v-for="item in store.cases" :key="item.id" class="case-row" @click="store.selectCase(item.id); $router.push('/execution')"><div><b>{{item.id}} · {{item.name}}</b><small>{{item.steps.filter((step)=>step.result!=='未执行').length}}/{{item.steps.length}} 步骤 · 关联 {{item.routeIds.join(' / ')}}</small></div><n-tag :type="item.status === '通过' ? 'success' : item.status === '失败' ? 'error' : item.status === '阻塞' ? 'warning' : 'info'">{{item.status}}</n-tag></div></article></div>
  </n-spin>
</template>
