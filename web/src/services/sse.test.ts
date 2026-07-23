import { describe, expect, it } from 'vitest'
import { parseSseStream } from './sse'

function stream(chunks: string[]) {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) { chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk))); controller.close() },
  })
}

describe('parseSseStream', () => {
  it('parses JSON events split across network chunks', async () => {
    const source = stream(['data: {"type":"meta","studentTurnId":1}\n\ndata: {"type":"del', 'ta","delta":"Hello"}\n\ndata: {"type":"done","turnId":"t2"}\n\n'])
    const events = []
    for await (const event of parseSseStream(source)) events.push(event)
    expect(events).toEqual([{ type: 'meta', studentTurnId: 1 }, { type: 'delta', delta: 'Hello' }, { type: 'done', turnId: 't2' }])
  })

  it('accepts plain text data and the DONE sentinel', async () => {
    const source = stream(['data: Plain response\r\n\r\ndata: [DONE]\r\n\r\n'])
    const events = []
    for await (const event of parseSseStream(source)) events.push(event)
    expect(events).toEqual([{ type: 'delta', delta: 'Plain response' }, { type: 'done' }])
  })
})
