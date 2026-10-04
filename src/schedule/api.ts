import type { PublishPayload } from './types'

/**
 * 下发接口模拟：
 *  - 可通过「模拟下一次写入失败」制造网络/磁盘故障；
 *  - 失败后客户端必须保留原可执行版本，并按同一计划号重试；
 *  - 服务端按 planNo 幂等：相同计划号的重复请求直接返回已接收结果，
 *    绝不产生重复下发。
 */

let failNextWrite = false
const receivedPlans = new Map<string, { acceptedAt: string; payload: PublishPayload }>()

export function setFailNextWrite(value: boolean) {
  failNextWrite = value
}

export function getReceivedPlans() {
  return [...receivedPlans.values()]
}

export async function publishWindow(payload: PublishPayload): Promise<{ planNo: string; accepted: boolean; idempotentHit: boolean }> {
  await new Promise((resolve) => setTimeout(resolve, 450))
  const existing = receivedPlans.get(payload.planNo)
  if (existing) {
    return { planNo: payload.planNo, accepted: true, idempotentHit: true }
  }
  if (failNextWrite) {
    failNextWrite = false
    throw new Error(`写入失败：调度中心持久化超时（计划号 ${payload.planNo}，请按该计划号重试，勿重新生成）`)
  }
  receivedPlans.set(payload.planNo, {
    acceptedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    payload,
  })
  return { planNo: payload.planNo, accepted: true, idempotentHit: false }
}
