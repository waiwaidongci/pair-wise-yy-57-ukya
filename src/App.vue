<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { useTestStore } from './store'

const route = useRoute()
const router = useRouter()
const store = useTestStore()
const nav = [
  { name:'overview', label:'回归总览' },
  { name:'station', label:'站场与进路' },
  { name:'cases', label:'测试用例' },
  { name:'execution', label:'执行记录' },
  { name:'release', label:'基线与报告' },
]
</script>

<template>
  <n-layout class="shell">
    <n-layout-sider :width="230" class="sider">
      <div class="brand"><span>联</span><div><b>信号联锁测试台</b><small>INTERLOCKING QA</small></div></div>
      <n-menu :value="String(route.name || 'overview')" :options="nav.map((item) => ({ key:item.name,label:item.label }))" @update:value="(key: string) => router.push({ name:key })" />
      <div class="station-card"><i :class="store.connection === '在线' ? 'online' : 'offline'"></i><div><b>海州站 CS</b><small>版本 v26.10 · {{store.connection}}</small></div></div>
    </n-layout-sider>
    <n-layout>
      <n-layout-header class="topbar"><div><b>海州站软件升级回归</b><small>联锁版本 CS-v26.10 · 计划发布 2026-10-03</small></div><div class="top-actions"><n-tag :type="store.connection === '在线' ? 'success' : 'warning'">{{ store.liveMessage }}</n-tag><n-button v-if="store.pendingRetry" type="warning" @click="store.retry">重试 {{store.pendingRetry}} 项</n-button><n-button type="primary" @click="store.startExecution">开始执行当前用例</n-button></div></n-layout-header>
      <n-layout-content class="main"><router-view /></n-layout-content>
    </n-layout>
  </n-layout>
</template>
