import assert from 'node:assert'
import { recomputeSchedule, transitiveDependents } from '../src/schedule/engine'
import { crews, scheduleDevices, seedSteps, seedWindows, frozenW2Schedule } from '../src/schedule/seed'
import type { ScheduleStep, SkylightWindow } from '../src/schedule/types'

const w1 = seedWindows.find((w) => w.id === 'W-1')!
const w2 = seedWindows.find((w) => w.id === 'W-2')!
const stepsOf = (win: SkylightWindow) => seedSteps.filter((s) => s.code.startsWith(win.id === 'W-1' ? 'W1' : 'W2'))
const byCode = (code: string) => seedSteps.find((s) => s.code === code)!
let failures = 0
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`PASS  ${name}`) }
  catch (e) { failures += 1; console.log(`FAIL  ${name}\n      ${(e as Error).message}`) }
}

// 1. 初始全量排程：资格不符、设备重叠、依赖阻断、旧数据补齐后可排入
const migrated = structuredClone(stepsOf(w1))
const legacy = migrated.find((s) => s.legacy)!
legacy.crewId = 'LG-SECTION' // 模拟旧数据升级补齐
const s0 = recomputeSchedule({ window: { ...w1, status: '草稿' }, steps: migrated, devices: scheduleDevices, crews })

check('初始：W1-01 排在 00:00', () => {
  const p = s0.placements.find((p) => p.stepId === byCode('W1-01').id)!
  assert.equal(p.startMin, 0)
})
check('初始：W1-03 资格不符（道岔专修2级 < 要求3级）', () => {
  assert.ok(s0.issues.some((i) => i.stepId === byCode('W1-03').id && i.type === '资格不符'))
})
check('初始：W1-04 资格不符（道岔班组无信号机资质）', () => {
  assert.ok(s0.issues.some((i) => i.stepId === byCode('W1-04').id && i.type === '资格不符'))
})
check('初始：W1-05 依赖无法满足（前置 W1-03 未排入）', () => {
  assert.ok(s0.issues.some((i) => i.stepId === byCode('W1-05').id && i.type === '依赖无法满足'))
})
check('初始：W1-06 资格不符（区段班组无信号机资质）', () => {
  assert.ok(s0.issues.some((i) => i.stepId === byCode('W1-06').id && i.type === '资格不符'))
})
check('初始：旧数据 W1-07 补齐班组后排入 00:00（独占 T-03）', () => {
  const p = s0.placements.find((p) => p.stepId === byCode('W1-07').id)!
  assert.equal(p.startMin, 0)
})
check('初始：W1-08 独立的 4 小时全程巡检与 W1-01 争用 T-01 整点段，报「设备重叠」', () => {
  assert.ok(s0.issues.some((i) => i.stepId === byCode('W1-08').id && i.type === '设备重叠'))
})
check('初始：W1-09 依赖已排入，接续排在 01:00（T-01 在 01:00 空出）', () => {
  const p = s0.placements.find((p) => p.stepId === byCode('W1-09').id)!
  assert.equal(p.startMin, 60)
})

// 2. 修复资格：W1-03/W1-04/W1-06 改派信号一工队，W1-08 缩短为 1 小时 → 全部门禁通过
const fixed = structuredClone(migrated)
const setCrew = (code: string, crewId: string) => { fixed.find((s) => s.code === code)!.crewId = crewId }
setCrew('W1-03', 'BZ-01')
setCrew('W1-04', 'BZ-01')
setCrew('W1-06', 'BZ-01')
fixed.find((s) => s.code === 'W1-08')!.durationMin = 60
const s1 = recomputeSchedule({ window: { ...w1, status: '草稿' }, steps: fixed, devices: scheduleDevices, crews })

check('修复后：零排不进去步骤', () => assert.equal(s1.issues.length, 0))
check('修复后：W1-03 排在 01:00（依赖 W1-01，且不与 W1-02 的 X-01 冲突）', () => {
  const p = s1.placements.find((p) => p.stepId === byCode('W1-03').id)!
  assert.equal(p.startMin, 60)
})
check('修复后：缩短后的 W1-08 与 W1-09 都能排入（T-01 02、03 时段空闲）', () => {
  const p8 = s1.placements.find((p) => p.stepId === byCode('W1-08').id)!
  const p9 = s1.placements.find((p) => p.stepId === byCode('W1-09').id)!
  assert.ok(p8.startMin >= 120)
  assert.ok(p9.startMin >= 120)
  assert.notEqual(p8.startMin, p9.startMin)
})
check('修复后：全部在 4 小时窗口内结束', () => {
  assert.ok(s1.placements.every((p) => p.endMin <= 240))
})

// 3. 时长更新增量重算：W1-01 60→120，仅自身及传递后继失效；无依赖的 W1-07/W1-08 锚点不动
const changed = structuredClone(fixed)
const root = changed.find((s) => s.code === 'W1-01')!
root.durationMin = 120
const affected = transitiveDependents(changed.filter((s) => s.code.startsWith('W1')), [root.id])
const s2 = recomputeSchedule({
  window: { ...w1, status: '草稿' },
  steps: changed,
  devices: scheduleDevices,
  crews,
  baseSchedule: s1,
  affectedStepIds: [...affected],
  pinnedStepIds: [root.id],
  changeNote: 'W1-01 60→120',
})
check('增量：W1-01 钉住起点变为 00:00–02:00', () => {
  const p = s2.placements.find((p) => p.stepId === byCode('W1-01').id)!
  assert.deepEqual([p.startMin, p.endMin], [0, 120])
})
check('增量：传递后继集合包含 W1-02…W1-06、W1-09；不含无依赖的 W1-07/W1-08', () => {
  for (const code of ['W1-02', 'W1-03', 'W1-04', 'W1-05', 'W1-06', 'W1-09']) assert.ok(affected.has(byCode(code).id), code)
  for (const code of ['W1-07', 'W1-08']) assert.ok(!affected.has(byCode(code).id), code)
})
check('增量：无依赖步骤 W1-07/W1-08 锚点保持不动', () => {
  const p7 = s2.placements.find((p) => p.stepId === byCode('W1-07').id)!
  const p8s1 = s1.placements.find((p) => p.stepId === byCode('W1-08').id)!
  const p8 = s2.placements.find((p) => p.stepId === byCode('W1-08').id)!
  assert.equal(p7.startMin, 0)
  assert.equal(p8.startMin, p8s1.startMin)
})
check('增量：后继 W1-09 因 T-01 被延长的 W1-01 占满 02:00 前时段而重排/列出，不丢步骤', () => {
  const accounted = new Set([...s2.placements.map((p) => p.stepId), ...s2.issues.map((i) => i.stepId)])
  for (const id of migrated.map((s) => s.id)) assert.ok(accounted.has(id), id)
})

// 3b. 钉住起点但容量不够：W1-01 时长改为 300 分钟 → 窗口容量不足
const overflow = structuredClone(fixed)
overflow.find((s) => s.code === 'W1-01')!.durationMin = 300
const affOverflow = transitiveDependents(overflow.filter((s) => s.code.startsWith('W1')), [byCode('W1-01').id])
const s2b = recomputeSchedule({
  window: { ...w1, status: '草稿' },
  steps: overflow,
  devices: scheduleDevices,
  crews,
  baseSchedule: s1,
  affectedStepIds: [...affOverflow],
  pinnedStepIds: [byCode('W1-01').id],
})
check('增量：变更步骤超容量报「窗口容量不足」', () => {
  assert.ok(s2b.issues.some((i) => i.stepId === byCode('W1-01').id && i.type === '窗口容量不足'))
})

// 4. 容量不足：单步 300 分钟
const over: ScheduleStep[] = [{ ...byCode('W1-01'), id: 'X1', code: 'X-01', durationMin: 300, deviceIds: ['P-09'], dependencyIds: [], crewId: 'BZ-02' }]
const s3 = recomputeSchedule({ window: { ...w1, status: '草稿' }, steps: over, devices: [...scheduleDevices, { id: 'P-09', name: '9# 道岔', kind: '道岔' }], crews })
check('容量：超出天窗报「窗口容量不足」而非设备重叠', () => {
  assert.ok(s3.issues[0].type === '窗口容量不足')
})

// 4b. 纯粹设备重叠（容量够但同设备小时段争用）：两个独立 4 小时步骤争同一设备
const contend: ScheduleStep[] = [
  { ...byCode('W1-01'), id: 'C1', code: 'C-01', durationMin: 240, deviceIds: ['P-09'], dependencyIds: [], crewId: 'BZ-02' },
  { ...byCode('W1-01'), id: 'C2', code: 'C-02', durationMin: 240, deviceIds: ['P-09'], dependencyIds: [], crewId: 'BZ-02' },
]
const s3b = recomputeSchedule({ window: { ...w1, status: '草稿' }, steps: contend, devices: [...scheduleDevices, { id: 'P-09', name: '9# 道岔', kind: '道岔' }], crews })
check('争用：容量够但设备被全天窗独占，第二步报「设备重叠」', () => {
  const issue = s3b.issues.find((i) => i.stepId === 'C2')
  assert.ok(issue && issue.type === '设备重叠')
})

// 4c. 钉住起点延长后与非受影响步骤的既有锚点重叠（真正的「设备重叠」）
const pinWin: SkylightWindow = { ...w1, id: 'WP', lengthMin: 480 } // 8 小时窗口
const pinBase = recomputeSchedule({
  window: { ...pinWin, status: '草稿' },
  steps: [
    { ...byCode('W1-01'), id: 'PA', code: 'P-01', durationMin: 60, dependencyIds: [], deviceIds: ['P-09'], crewId: 'BZ-02' },
    { ...byCode('W1-01'), id: 'PB', code: 'P-02', durationMin: 60, dependencyIds: [], deviceIds: ['P-09'], crewId: 'BZ-02' },
  ],
  devices: [...scheduleDevices, { id: 'P-09', name: '9# 道岔', kind: '道岔' }],
  crews,
})
// PA 在 0 段，PB 独立步骤落在 1 段；把 PA 延长为 120 分钟并钉住起点 → 与 PB 的锚点（1 段）冲突
const pinChanged: ScheduleStep[] = [
  { ...byCode('W1-01'), id: 'PA', code: 'P-01', durationMin: 120, dependencyIds: [], deviceIds: ['P-09'], crewId: 'BZ-02' },
  { ...byCode('W1-01'), id: 'PB', code: 'P-02', durationMin: 60, dependencyIds: [], deviceIds: ['P-09'], crewId: 'BZ-02' },
]
const pinAffected = transitiveDependents(pinChanged, ['PA'])
const s3c = recomputeSchedule({
  window: { ...pinWin, status: '草稿' },
  steps: pinChanged,
  devices: [...scheduleDevices, { id: 'P-09', name: '9# 道岔', kind: '道岔' }],
  crews,
  baseSchedule: pinBase,
  affectedStepIds: [...pinAffected],
  pinnedStepIds: ['PA'],
})
check('增量：钉住起点延长与未失效锚点冲突报「设备重叠」，未失效步骤 PB 保持 01:00 锚点', () => {
  const issue = s3c.issues.find((i) => i.stepId === 'PA')
  assert.ok(issue && issue.type === '设备重叠')
  const pb = s3c.placements.find((p) => p.stepId === 'PB')!
  assert.equal(pb.startMin, 60)
})

// 5. 已下发窗口冻结：传 frozen 原样返回，且即便步骤改烂也不动
const tampered = structuredClone(stepsOf(w2))
tampered[0].durationMin = 300
tampered[0].crewId = undefined
const s4 = recomputeSchedule({ window: { ...w2 }, steps: tampered, devices: scheduleDevices, crews, frozen: frozenW2Schedule })
check('已下发：冻结快照原样返回', () => {
  assert.equal(s4, frozenW2Schedule)
})

console.log(failures ? `\n${failures} 项失败` : '\n引擎行为全部符合预期')
process.exit(failures ? 1 : 0)
