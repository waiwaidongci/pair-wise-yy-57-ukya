import { onBeforeUnmount, onMounted } from 'vue'

export function useExecutionSocket(onProgress: (value: number) => void, onState: (state: '在线' | '重连中') => void) {
  let socket: WebSocket | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  function connect() {
    const url = import.meta.env.VITE_WS_URL as string | undefined
    if (url) {
      socket = new WebSocket(url)
      socket.onmessage = (event) => onProgress(JSON.parse(event.data).progress)
      socket.onclose = () => onState('重连中')
      return
    }
    onState('在线')
    let value = 42
    timer = setInterval(() => { value = Math.min(100, value + 17); onProgress(value) }, 12000)
  }
  onMounted(connect)
  onBeforeUnmount(() => { if (timer) clearInterval(timer); socket?.close() })
}
