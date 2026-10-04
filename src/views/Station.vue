<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { routes, devices } from '../mock'
import { useTestStore } from '../store'

const store = useTestStore()
const canvas = ref<HTMLCanvasElement>()
const zoom = ref(1)
let ctx: CanvasRenderingContext2D | undefined
let resizeObserver: ResizeObserver | undefined

function draw() {
  const element = canvas.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  element.width = rect.width * ratio
  element.height = rect.height * ratio
  const context = element.getContext('2d')
  if (!context) return
  ctx = context
  context.scale(ratio, ratio)
  context.clearRect(0, 0, rect.width, rect.height)
  context.fillStyle = '#f8fafc'; context.fillRect(0, 0, rect.width, rect.height)
  const unitX = rect.width / 100; const unitY = rect.height / 100
  context.strokeStyle = '#e2e8f0'; context.lineWidth = 1
  for (let i=0;i<=100;i+=5) { context.beginPath(); context.moveTo(i*unitX,0); context.lineTo(i*unitX,rect.height); context.stroke(); context.beginPath(); context.moveTo(0,i*unitY); context.lineTo(rect.width,i*unitY); context.stroke() }
  context.lineCap = 'round'; context.lineJoin = 'round'
  routes.forEach((route) => {
    const selected = store.selectedRouteIds.includes(route.id)
    context.beginPath(); route.points.forEach((point,index)=>{ const x=point[0]*unitX, y=point[1]*unitY; if(index===0)context.moveTo(x,y); else context.lineTo(x,y) })
    context.strokeStyle = selected ? route.color : '#94a3b8'; context.lineWidth = selected ? 7 : 3; context.globalAlpha = selected ? 1 : .42; context.stroke(); context.globalAlpha = 1
  })
  devices.forEach((device) => {
    const active = store.selectedCase?.routeIds.some((routeId) => device.routeIds.includes(routeId))
    context.beginPath(); context.arc(device.x*unitX, device.y*unitY, active ? 12 : 8, 0, Math.PI*2)
    context.fillStyle = device.kind === '道岔' ? (active ? '#d97706' : '#94a3b8') : device.kind === '信号机' ? (active ? '#16a34a' : '#64748b') : (active ? '#2563eb' : '#cbd5e1'); context.fill(); context.strokeStyle='#fff'; context.lineWidth=3; context.stroke()
    context.fillStyle = '#0f172a'; context.font = '600 12px sans-serif'; context.fillText(device.id, device.x*unitX+13, device.y*unitY-10)
  })
}
function hitTest(event: MouseEvent) {
  const rect = canvas.value!.getBoundingClientRect(); const x=event.offsetX, y=event.offsetY
  let closest = routes[0]!; let distance = Infinity
  routes.forEach((route)=>{ route.points.forEach((point)=>{ const d=Math.hypot(point[0]/100*rect.width-x,point[1]/100*rect.height-y); if(d<distance){distance=d;closest=route} }) })
  if (distance < 45) store.selectedRouteIds = [closest.id]
}
onMounted(async()=>{ await nextTick(); draw(); resizeObserver=new ResizeObserver(draw); resizeObserver.observe(canvas.value!) })
onBeforeUnmount(()=>resizeObserver?.disconnect())
watch(()=>store.selectedCaseId, draw)
watch(()=>store.selectedRouteIds, draw, { deep:true })
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">站场与进路关系</p><h1>Canvas 站场示意</h1><p>点击进路联动设备清单和受影响用例；缩放后可检查道岔、信号机和轨道区段关系。</p></div><n-space><n-button @click="zoom=Math.max(.7,zoom-.1); draw()">缩小</n-button><span>{{Math.round(zoom*100)}}%</span><n-button @click="zoom=Math.min(1.5,zoom+.1); draw()">放大</n-button></n-space></section>
  <div class="station-grid"><article class="card canvas-card"><div class="canvas-head"><span>海州站 · 计算机联锁平面示意</span><span>实线高亮：当前用例关联进路</span></div><canvas ref="canvas" class="station-canvas" @click="hitTest" /></article>
    <aside class="card"><div class="panel-head"><div><h2>进路关系</h2><p>点击高亮或选择用例</p></div><n-tag>{{store.selectedRouteIds.length}} 条</n-tag></div><button v-for="route in routes" :key="route.id" class="route-row" :class="{active:store.selectedRouteIds.includes(route.id)}" @click="store.selectedRouteIds=[route.id]"><i :style="{background:route.color}"></i><div><b>{{route.id}} · {{route.name}}</b><small>{{route.devices.join(' → ')}}</small></div></button><n-divider /><h3>设备变更影响</h3><n-alert v-for="item in routes.filter((route)=>store.selectedRouteIds.includes(route.id)).flatMap((route)=>route.affectedBy)" :key="item" type="warning" :title="item" class="issue" /></aside></div>
</template>
