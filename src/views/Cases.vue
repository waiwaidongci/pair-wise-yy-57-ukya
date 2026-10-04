<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTestStore } from '../store'

const store = useTestStore()
const editMode = ref(false)
const selectedCase = computed(() => store.selectedCase)
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">步骤、预期与依赖</p><h1>测试用例编排</h1><p>把执行动作、预期结果、前置条件和依赖串成可重复执行的用例，版本升级后自动推导回归范围。</p></div><n-space><n-switch v-model:value="editMode">批量编辑模式</n-switch><n-button type="primary">新增用例</n-button></n-space></section>
  <div class="case-grid"><aside class="card case-list"><n-input placeholder="搜索用例、进路或设备" clearable /><button v-for="item in store.cases" :key="item.id" :class="{active:item.id===store.selectedCaseId}" @click="store.selectCase(item.id)"><div><b>{{item.id}}</b><small>{{item.name}}</small></div><n-tag :type="item.status==='通过'?'success':item.status==='失败'?'error':item.status==='阻塞'?'warning':'info'">{{item.status}}</n-tag></button></aside>
    <article class="card detail" v-if="selectedCase"><div class="panel-head"><div><h2>{{selectedCase.id}} · {{selectedCase.name}}</h2><p>{{selectedCase.precondition}}</p></div><n-tag type="info">{{selectedCase.version}}</n-tag></div><n-alert v-if="selectedCase.failureReason" type="error" title="当前阻塞 / 失败原因" :description="selectedCase.failureReason" /><h3>执行步骤与依赖</h3><div v-for="(step,index) in selectedCase.steps" :key="step.id" class="step"><div class="step-index">{{index+1}}</div><div class="step-main"><div class="step-head"><b>{{step.action}}</b><n-tag :type="step.result==='通过'?'success':step.result==='失败'?'error':'info'">{{step.result}}</n-tag></div><p>预期：{{step.expected}}</p><small v-if="step.dependency">依赖步骤：{{step.dependency}}</small><small v-if="step.actual">实测：{{step.actual}}</small><small v-if="step.evidence">证据：{{step.evidence}}</small></div><n-button v-if="editMode" size="small" @click="store.setStepResult(selectedCase.id,step.id,'通过','批量编辑确认')">标记通过</n-button></div><n-divider /><div class="dependency"><b>依赖图</b><div class="nodes"><span v-for="step in selectedCase.steps" :key="step.id">{{step.id}}</span></div><div class="lines">→ 顺序执行 · 前一步未通过时不得跳过</div></div></article></div>
</template>
