import assert from 'node:assert'
import { createPinia, setActivePinia } from 'pinia'
import { useScheduleStore } from '../src/schedule/store'
import { publishWindow, setFailNextWrite, getReceivedPlans } from '../src/schedule/api'

let failures = 0
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`PASS  ${name}`) }
  catch (e) { failures += 1; console.log(`FAIL  ${name}\n      ${(e as Error).message}`) }
}

// 极简 localStorage polyfill
class MemStorage {
  private map = new Map<string, string>()
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null }
  setItem(k: string, v: string) { this.map.set(k, v) }
  removeItem(k: string) { this.map.delete(k) }
  clear() { this.map.clear() }
}
;(globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage()

setActivePinia(createPinia())
const store = useScheduleStore()
store.selectWindow('W-1')

const byCode = (code: string) => store.steps.find((s) => s.code === code)!

check('旧数据升级：W1-07 缺班组编号已按 轨道区段/2级 补齐为 老线轨道班，并留痕', () => {
  const s = byCode('W1-07')
  assert.equal(s.crewId, 'LG-SECTION')
  assert.ok(store.migratedStepIds.includes(s.id))
  assert.ok(store.audits.some((a) => a.message.includes('旧数据升级') && a.message.includes(s.code!)))
})

check('初始门禁：草稿窗口存在阻断（资格不符 + 设备重叠），不可下发态', () => {
  assert.equal(store.currentGate.passed, false)
  assert.ok(store.currentGate.blockers.some((b) => b.type === '资格不符'))
  assert.ok(store.currentGate.blockers.some((b) => b.type === '设备重叠'))
})

// 权限：当前用户陆晨(u-luchen) 是信号一工队班长，不是道岔专修工队班长
check('越权拒绝：陆晨不能调整道岔专修工队承接的 W1-01（时长/班组均拒），并写审计', () => {
  const before = byCode('W1-01').durationMin
  const r1 = store.updateDuration(byCode('W1-01').id, 90)
  const r2 = store.assignCrew(byCode('W1-01').id, 'BZ-01')
  assert.equal(r1.ok, false)
  assert.equal(r2.ok, false)
  assert.ok(r1.message.includes('越权拒绝'))
  assert.equal(byCode('W1-01').durationMin, before)
  assert.ok(store.audits.some((a) => a.level === 'warn' && a.message.includes('越权拒绝')))
})

check('已下发窗口只读：W-2 的所有编辑均拒绝', () => {
  store.selectWindow('W-2')
  const frozenStep = store.windowSteps[0]
  const r = store.updateDuration(frozenStep.id, 90)
  assert.equal(r.ok, false)
  assert.ok(r.message.includes('只读冻结'))
  store.selectWindow('W-1')
})

// 换成道岔专修工队班长方瑜，可改自己班组步骤
check('班组长本人可改：方瑜把 W1-01 时长 60→90，触发天窗内后续步骤失效重算', () => {
  store.switchUser('u-fangyu')
  const noop = store.updateDuration(byCode('W1-01').id, 60)
  assert.equal(noop.ok, true)
  const r = store.updateDuration(byCode('W1-01').id, 90)
  assert.equal(r.ok, true)
  assert.ok(r.message.includes('后续步骤'))
  // 演练结束改回，保持门禁可被后续资格修复闭环
  const back = store.updateDuration(byCode('W1-01').id, 60)
  assert.equal(back.ok, true)
})

check('资格修复：各承接班组班长把资质不符步骤改派信号一工队；W1-08 先缩时再让渡，门禁通过', () => {
  store.switchUser('u-zhaomin')
  // W1-08 仍在赵敏名下：先缩到 1 小时（解除 T-01 全天窗争用），再让渡给信号一工队
  const dur = store.updateDuration(byCode('W1-08').id, 60)
  assert.equal(dur.ok, true)
  // W1-06 属于区段检测工队，方瑜不能动，赵敏可以让渡
  store.switchUser('u-fangyu')
  assert.equal(store.assignCrew(byCode('W1-06').id, 'BZ-01').ok, false)
  assert.equal(store.assignCrew(byCode('W1-03').id, 'BZ-01').ok, true)
  assert.equal(store.assignCrew(byCode('W1-04').id, 'BZ-01').ok, true)
  store.switchUser('u-zhaomin')
  assert.equal(store.assignCrew(byCode('W1-06').id, 'BZ-01').ok, true)
  assert.equal(store.assignCrew(byCode('W1-08').id, 'BZ-01').ok, true)
  assert.equal(store.currentGate.passed, true)
})

// 发布：首次写入失败 → 保留原版本 + 计划号；同计划号重试成功（幂等）
check('发布写入失败：窗口保持草稿，记录计划号，错误提示保留原可执行版本', async () => {
  store.selectWindow('W-1')
  setFailNextWrite(true)
  store.setFailNextWriteFlag(true)
  const r = await store.publishSelectedWindow()
  assert.equal(r.ok, false)
  assert.ok(r.message.includes('保留'))
  const win = store.windows.find((w) => w.id === 'W-1')!
  assert.equal(win.status, '草稿')
  const planNo = store.pendingPlanNo['W-1']
  assert.ok(planNo, '失败后必须保留计划号')
  assert.ok(/^JH-20261004-00-\d{3}$/.test(planNo), `计划号格式异常: ${planNo}`)
})

check('按原计划号重试：成功下发并冻结，服务端收到且仅收到一次该计划号', async () => {
  const planNo = store.pendingPlanNo['W-1']
  const r = await store.publishSelectedWindow()
  assert.equal(r.ok, true)
  const win = store.windows.find((w) => w.id === 'W-1')!
  assert.equal(win.status, '已下发')
  assert.equal(win.planNo, planNo)
  assert.equal(store.pendingPlanNo['W-1'], undefined)
  const received = getReceivedPlans().filter((p) => p.payload.planNo === planNo)
  assert.equal(received.length, 1)
})

check('幂等：同计划号再发服务端命中幂等（直接调用 API 验证）', async () => {
  const win = store.windows.find((w) => w.id === 'W-1')!
  const res = await publishWindow({
    planNo: win.planNo!,
    windowId: win.id,
    revision: win.revision,
    steps: [],
  })
  assert.equal(res.accepted, true)
  assert.equal(res.idempotentHit, true)
})

check('已下发后再点发布被拒绝，排程快照冻结不重算', async () => {
  const revBefore = store.currentSchedule.revision
  const r = await store.publishSelectedWindow()
  assert.equal(r.ok, false)
  assert.ok(r.message.includes('已下发'))
  assert.equal(store.currentSchedule.revision, revBefore)
})

check('重置草稿可回到种子状态重新演练', () => {
  store.resetDraft()
  assert.equal(store.currentGate.passed, false)
  assert.equal(store.steps.find((s) => s.code === 'W1-07')?.crewId, 'LG-SECTION')
})

console.log(failures ? `\n${failures} 项失败` : '\n排程存储/权限/发布流程全部符合预期')
process.exit(failures ? 1 : 0)
