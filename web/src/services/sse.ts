import { api } from './api'

export interface PatientStreamEvent { type: 'meta' | 'delta' | 'done' | 'error'; delta?: string; turnId?: string; studentTurnId?: number; message?: string }

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
        const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
        if (data && data !== '[DONE]') {
          try { yield JSON.parse(data) as PatientStreamEvent }
          catch { yield { type: 'delta', delta: data } }
        } else if (data === '[DONE]') yield { type: 'done' }
        boundary = buffer.indexOf('\n\n')
      }
      if (done) break
    }
  } finally { reader.releaseLock() }
}

export async function streamPatientReply(sessionId: string, content: string, signal?: AbortSignal) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${api.getToken() || ''}` },
    body: JSON.stringify({ content }), signal,
  })
  if (!response.ok) throw new Error((await response.text()) || `Patient response failed (${response.status})`)
  if (!response.body) throw new Error('The response stream was unavailable.')
  return parseSseStream(response.body)
}
