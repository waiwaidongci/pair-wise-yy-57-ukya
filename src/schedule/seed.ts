import type { Crew, ScheduleDevice, ScheduleStep, SkylightWindow, WindowSchedule } from './types'
import { devices as stationDevices } from '../mock'

export const scheduleDevices: ScheduleDevice[] = stationDevices.map((d) => ({
  id: d.id,
  name: d.name,
  kind: d.kind,
}))

export const crews: Crew[] = [
  { id: 'BZ-01', name: '信号一工队', ownerUserId: 'u-luchen', level: 3, qualifications: ['道岔', '信号机', '轨道区段'] },
  { id: 'BZ-02', name: '道岔专修工队', ownerUserId: 'u-fangyu', level: 2, qualifications: ['道岔'] },
  { id: 'BZ-03', name: '区段检测工队', ownerUserId: 'u-zhaomin', level: 2, qualifications: ['轨道区段'] },
  // 旧台账里的工班，只有名称没有编号；迁移时按设备资格与等级升级补齐（带 legacy 标记优先命中）
  { id: 'LG-SECTION', name: '老线轨道班', ownerUserId: 'u-laowei', level: 2, qualifications: ['轨道区段'], legacy: true },
]

export const users: Array<{ id: string; name: string }> = [
  { id: 'u-luchen', name: '陆晨（信号一工队班长）' },
  { id: 'u-fangyu', name: '方瑜（道岔专修工队班长）' },
  { id: 'u-zhaomin', name: '赵敏（区段检测工队班长）' },
  { id: 'u-laowei', name: '老魏（老线轨道班）' },
  { id: 'u-guest', name: '外部检修人员' },
]

export const seedWindows: SkylightWindow[] = [
  { id: 'W-1', name: '10月4日 凌晨综合检修天窗', date: '2026-10-04', startHour: 0, lengthMin: 240, status: '草稿', revision: 0 },
  { id: 'W-2', name: '10月3日 夜间联锁检修天窗', date: '2026-10-03', startHour: 22, lengthMin: 240, status: '已下发', planNo: 'JH-20261003-22-017', publishedAt: '2026-10-03 20:12', revision: 3 },
]

export const seedSteps: ScheduleStep[] = [
  // —— W-1：当前草稿天窗 ——
  { id: 'JX-101', code: 'W1-01', title: 'P-01 道岔扳动与表示核对', kind: '道岔', requiredLevel: 2, durationMin: 60, dependencyIds: [], deviceIds: ['P-01', 'T-01'], crewId: 'BZ-02' },
  { id: 'JX-102', code: 'W1-02', title: 'X 进站信号机开放试验', kind: '信号机', requiredLevel: 2, durationMin: 60, dependencyIds: ['JX-101'], deviceIds: ['X-01'], crewId: 'BZ-01' },
  { id: 'JX-103', code: 'W1-03', title: 'P-02 转辙机更换后动作试验', kind: '道岔', requiredLevel: 3, durationMin: 60, dependencyIds: ['JX-101'], deviceIds: ['P-02', 'T-01', 'T-02'], crewId: 'BZ-02' },
  { id: 'JX-104', code: 'W1-04', title: 'S 出站信号机复核', kind: '信号机', requiredLevel: 2, durationMin: 60, dependencyIds: ['JX-102', 'JX-103'], deviceIds: ['S-01'], crewId: 'BZ-02' },
  { id: 'JX-105', code: 'W1-05', title: '2G 轨道区段占用与出清试验', kind: '轨道区段', requiredLevel: 2, durationMin: 60, dependencyIds: ['JX-103'], deviceIds: ['T-02'], crewId: 'BZ-03' },
  { id: 'JX-106', code: 'W1-06', title: 'S2 出站信号机联动关闭测试', kind: '信号机', requiredLevel: 2, durationMin: 60, dependencyIds: ['JX-103'], deviceIds: ['S-02'], crewId: 'BZ-03' },
  { id: 'JX-107', code: 'W1-07', title: '3G 绝缘节调整后区段校核（旧台账迁入）', kind: '轨道区段', requiredLevel: 2, durationMin: 60, dependencyIds: [], deviceIds: ['T-03'], legacy: true, legacySource: '2026-09 纸质天窗台账转录，缺班组编号' },
  { id: 'JX-108', code: 'W1-08', title: '1G 轨道区段全程占用巡检', kind: '轨道区段', requiredLevel: 1, durationMin: 240, dependencyIds: [], deviceIds: ['T-01'], crewId: 'BZ-03' },
  { id: 'JX-109', code: 'W1-09', title: '1G 轨道区段接续复核', kind: '轨道区段', requiredLevel: 1, durationMin: 60, dependencyIds: ['JX-101'], deviceIds: ['T-01'], crewId: 'BZ-03' },

  // —— W-2：已下发天窗（冻结，不重算） ——
  { id: 'JX-201', code: 'W2-01', title: 'P-03 道岔定反位转换测试', kind: '道岔', requiredLevel: 2, durationMin: 60, dependencyIds: [], deviceIds: ['P-03'], crewId: 'BZ-02' },
  { id: 'JX-202', code: 'W2-02', title: 'R-04 进路排列与 S2 信号开放', kind: '信号机', requiredLevel: 2, durationMin: 60, dependencyIds: ['JX-201'], deviceIds: ['S-02', 'T-03'], crewId: 'BZ-01' },
]

/** W-2 下发时冻结的排程结果（已下发窗口不随任何变更改动） */
export const frozenW2Schedule: WindowSchedule = {
  windowId: 'W-2',
  revision: 3,
  placements: [
    { stepId: 'JX-201', startMin: 0, endMin: 60 },
    { stepId: 'JX-202', startMin: 60, endMin: 120 },
  ],
  issues: [],
  recomputedAt: '2026-10-03 20:12',
}
