import type { ExecutionRecord, MaintenanceWindow, ScheduleAssignment, StationDevice, Team, TeamMember, TestCase } from './types'

export const devices: StationDevice[] = [
  { id:'P-01',name:'1# 道岔',kind:'道岔',x:18,y:58,routeIds:['R-01','R-02'] },
  { id:'P-02',name:'2# 道岔',kind:'道岔',x:42,y:58,routeIds:['R-01','R-03'] },
  { id:'P-03',name:'3# 道岔',kind:'道岔',x:67,y:58,routeIds:['R-02','R-04'] },
  { id:'X-01',name:'X 进站信号机',kind:'信号机',x:9,y:35,routeIds:['R-01','R-03'] },
  { id:'S-01',name:'S 出站信号机',kind:'信号机',x:88,y:35,routeIds:['R-01','R-02','R-04'] },
  { id:'S-02',name:'S2 出站信号机',kind:'信号机',x:74,y:78,routeIds:['R-02','R-04'] },
  { id:'T-01',name:'1G 轨道区段',kind:'轨道区段',x:29,y:45,routeIds:['R-01','R-02'] },
  { id:'T-02',name:'2G 轨道区段',kind:'轨道区段',x:55,y:45,routeIds:['R-01','R-03','R-04'] },
  { id:'T-03',name:'3G 轨道区段',kind:'轨道区段',x:77,y:65,routeIds:['R-02','R-04'] },
]

export const routes = [
  { id:'R-01',name:'X → 1G → S',color:'#2563eb',points:[[9,35],[18,35],[18,58],[42,58],[42,45],[88,45],[88,35]] as [number,number][],devices:['X-01','P-01','P-02','T-01','T-02','S-01'],affectedBy:['P-02 转辙机更换'] },
  { id:'R-02',name:'X → 2G → S2',color:'#059669',points:[[9,35],[18,35],[18,58],[42,58],[67,58],[67,65],[74,65],[74,78],[88,78]] as [number,number][],devices:['X-01','P-01','P-02','P-03','T-01','T-03','S-02'],affectedBy:['P-02 转辙机更换','T-03 绝缘节调整'] },
  { id:'R-03',name:'X → 2G → S',color:'#d97706',points:[[9,35],[18,35],[18,58],[42,58],[42,45],[88,45],[88,35]] as [number,number][],devices:['X-01','P-01','P-02','T-02','S-01'],affectedBy:['P-02 转辙机更换'] },
  { id:'R-04',name:'2G → 3G → S2',color:'#7c3aed',points:[[42,45],[67,45],[67,58],[67,65],[74,65],[74,78],[88,78]] as [number,number][],devices:['P-03','T-02','T-03','S-02'],affectedBy:['T-03 绝缘节调整'] },
]

export const seedCases: TestCase[] = [
  { id:'TC-101',name:'X 至 S 正线接车进路建立',routeIds:['R-01'],precondition:'1G、2G 空闲，道岔在定位，无敌对进路',version:'v26.09',status:'通过',steps:[{id:'TS-1',action:'排列 X → S 接车进路',expected:'X 信号开放，P-01/P-02 锁闭',result:'通过',actual:'信号开放，联锁状态一致',evidence:'截图 XS-026',requiredQualifications:['信号机操作','道岔操作']},{id:'TS-2',action:'人工扳动 P-02',expected:'道岔锁闭，操作被拒绝',result:'通过',actual:'拒绝并记录操作',evidence:'日志 LG-108',requiredQualifications:['道岔操作','转辙机更换']}] },
  { id:'TC-102',name:'X 至 S2 侧线接车与3G占用',routeIds:['R-02'],precondition:'3G 空闲，P-03 反位',version:'v26.09',status:'执行中',steps:[{id:'TS-3',action:'排列 X → S2 侧线进路',expected:'X、S2 信号开放，P-03 锁闭反位',result:'通过',actual:'进路建立正常',evidence:'截图 XS-031',dependency:'TS-1',requiredQualifications:['信号机操作','道岔操作']},{id:'TS-4',action:'模拟 3G 轨道区段占用',expected:'立即关闭 S2 信号，保持进路锁闭',result:'未执行',dependency:'TS-3',requiredQualifications:['轨道区段作业']}] },
  { id:'TC-103',name:'敌对进路 R-01 / R-02 互锁',routeIds:['R-01','R-02'],precondition:'1G 空闲，P-01/P-02 可转换',version:'v26.09',status:'失败',failureReason:'实测可短暂同时开放 X 信号，疑似软件版本差异',steps:[{id:'TS-5',action:'建立 R-01 后尝试排列 R-02',expected:'拒绝排列并保持 R-01 锁闭',result:'失败',actual:'R-02 请求进入等待态，X 信号未保持',evidence:'录屏 VID-014、日志 LG-119',requiredQualifications:['联锁试验','信号机操作']}] },
  { id:'TC-104',name:'2G 至3G 调车进路和绝缘节',routeIds:['R-04'],precondition:'T-02、T-03 空闲',version:'v26.10',status:'阻塞',failureReason:'等待 T-03 绝缘节调整完成',steps:[{id:'TS-6',action:'排列 2G → 3G 调车进路',expected:'D 信号开放，P-03 反位锁闭',result:'未执行',dependency:'TS-4',requiredQualifications:['绝缘节调整','轨道区段作业']}] },
]

// ===== 班组与人员资质 =====
export const teams: Team[] = [
  { id:'G1', name:'信号检修一班', leaderId:'U-01', leaderName:'郑凯' },
  { id:'G2', name:'信号检修二班', leaderId:'U-03', leaderName:'高翔' },
  { id:'G3', name:'信号检修三班', leaderId:'U-05', leaderName:'罗成' },
]

export const members: TeamMember[] = [
  { id:'U-01', name:'郑凯', teamId:'G1', qualifications:['道岔操作','转辙机更换'] },
  { id:'U-02', name:'方瑜', teamId:'G1', qualifications:['信号机操作','联锁试验'] },
  { id:'U-03', name:'高翔', teamId:'G2', qualifications:['道岔操作','绝缘节调整'] },
  { id:'U-04', name:'唐娜', teamId:'G2', qualifications:['信号机操作','轨道区段作业'] },
  { id:'U-05', name:'罗成', teamId:'G3', qualifications:['联锁试验','绝缘节调整'] },
  { id:'U-06', name:'韩雪', teamId:'G3', qualifications:['轨道区段作业','转辙机更换'] },
]

// ===== 天窗（检修窗口） =====
export const windows: MaintenanceWindow[] = [
  { id:'W-2610-01', planId:'JH-2610-01', name:'v26.10 升级天窗（一）', date:'2026-10-08', startHour:14, endHour:15, status:'草稿', scope:'R-01/R-02 接车进路联锁试验' },
  { id:'W-2610-02', planId:'JH-2610-02', name:'v26.10 升级天窗（二）', date:'2026-10-09', startHour:9, endHour:10, status:'草稿', scope:'R-02/R-04 轨道区段与绝缘节试验' },
  { id:'W-2609-07', planId:'JH-2609-07', name:'v26.09 升级天窗', date:'2026-09-30', startHour:14, endHour:16, status:'已下发', scope:'R-01 进路建立与扳动试验' },
]

// 已下发天窗的冻结排程（重算不动）
export const seedAssignments: ScheduleAssignment[] = [
  { planId:'JH-2609-07', windowId:'W-2609-07', caseId:'TC-101', stepId:'TS-1', startHour:14, endHour:15, deviceIds:['X-01','P-01','P-02','S-01'], qualifications:['信号机操作','道岔操作'], teamId:'G1', teamName:'信号检修一班', assigneeId:'U-02', assigneeName:'方瑜', status:'已排' },
  { planId:'JH-2609-07', windowId:'W-2609-07', caseId:'TC-101', stepId:'TS-2', startHour:15, endHour:16, deviceIds:['P-02'], qualifications:['道岔操作','转辙机更换'], teamId:'G1', teamName:'信号检修一班', assigneeId:'U-01', assigneeName:'郑凯', status:'已排' },
]

export const seedExecutions: ExecutionRecord[] = [
  { id:'EX-260929-04',caseId:'TC-103',operator:'陆晨',startedAt:'16:10',finishedAt:'16:38',snapshot:'v26.09 / CS-LEU-08',result:'失败',evidence:['VID-014','LG-119'] },
  { id:'EX-260929-03',caseId:'TC-101',operator:'陆晨',startedAt:'15:20',finishedAt:'15:44',snapshot:'v26.09 / CS-LEU-08',result:'通过',evidence:['XS-026','LG-108'] },
  { id:'EX-260929-02',caseId:'TC-102',operator:'方瑜',startedAt:'14:52',snapshot:'v26.09 / CS-LEU-08',result:'执行中',evidence:['XS-031'] },
]
