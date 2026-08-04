import { api, expireAuthSession } from './api'

export interface PatientStreamEvent { type: 'meta' | 'delta' | 'done' | 'error' | 'heartbeat'; delta?: string; turnId?: string; studentTurnId?: number; message?: string }

function parseBlock(block: string): PatientStreamEvent | undefined {
  const lines = block.split('\n')
  const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
  if (!data) return lines.some((line) => line.startsWith(':')) ? { type: 'heartbeat' } : undefined
  if (data === '[DONE]') return { type: 'done' }
  try { return JSON.parse(data) as PatientStreamEvent }
  catch { return { type: 'delta', delta: data } }
}

export async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<PatientStreamEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const event = parseBlock(block)
        if (event) yield event
        boundary = buffer.indexOf('\n\n')
      }
      if (done) {
        const event = parseBlock(buffer)
        if (event) yield event
        break
      }
    }
  } finally { reader.releaseLock() }
}

export async function streamPatientReply(sessionId: string, content: string, signal?: AbortSignal, clientMessageId?: string) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${api.getToken() || ''}` },
    body: JSON.stringify({ content, ...(clientMessageId ? { clientMessageId } : {}) }), signal,
  })
  if (!response.ok) {
    if (response.status === 401 && api.getToken()) expireAuthSession()
    const raw = await response.text()
    let message = ''
    try {
      const parsed = JSON.parse(raw) as { message?: unknown }
      if (typeof parsed.message === 'string' && parsed.message.length <= 300) message = parsed.message
    } catch { /* A proxy may return HTML; never surface it in the UI. */ }
    throw new Error(message || `Patient response failed (${response.status})`)
  }
  if (!response.body) throw new Error('The response stream was unavailable.')
  return parseSseStream(response.body)
}
