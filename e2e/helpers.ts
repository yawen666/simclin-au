import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test'

export const API_BASE = 'http://127.0.0.1:4000/api'
export const FACULTY_ACCESS_CODE = 'simclin-e2e-faculty-code'

export async function expectApiOk(response: APIResponse, label: string): Promise<void> {
  if (response.ok()) return
  throw new Error(`${label} failed with ${response.status()}: ${await response.text()}`)
}

export async function apiLogin(request: APIRequestContext, role: 'student' | 'faculty') {
  const response = await request.post(`${API_BASE}/auth/demo`, {
    data: {
      role,
      ...(role === 'faculty'
        ? { accessCode: FACULTY_ACCESS_CODE }
        : { visitorId: `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` }),
    },
  })
  await expectApiOk(response, `${role} demo login`)
  return response.json() as Promise<{ token: string; user: { id: number; name: string; role: string } }>
}

export async function createCompletedAttempt(request: APIRequestContext, caseId = 1) {
  const { token } = await apiLogin(request, 'student')
  const headers = { Authorization: `Bearer ${token}` }

  const started = await request.post(`${API_BASE}/sessions`, { headers, data: { caseId } })
  await expectApiOk(started, 'start consultation')
  const startBody = await started.json() as { id?: number; session?: { id: number } }
  const sessionId = startBody.session?.id ?? startBody.id
  if (!sessionId) throw new Error('The session response did not include an id')

  const message = await request.post(`${API_BASE}/sessions/${sessionId}/messages`, {
    headers: { ...headers, Accept: 'text/event-stream' },
    data: { content: 'Could you tell me more about what brought you in today?' },
  })
  await expectApiOk(message, 'stream patient response')
  await message.body()

  const completed = await request.post(`${API_BASE}/sessions/${sessionId}/complete`, { headers })
  await expectApiOk(completed, 'complete consultation')
  expect(await completed.json()).toMatchObject({ status: 'evaluating' })

  let result: { id: string; sessionId: string; caseTitle: string; score: number } | undefined
  await expect.poll(async () => {
    const response = await request.get(`${API_BASE}/sessions/${sessionId}`, { headers })
    await expectApiOk(response, 'poll consultation evaluation')
    const body = await response.json() as {
      evaluationStatus?: string
      result?: typeof result
    }
    if (body.evaluationStatus === 'failed') throw new Error('Background evaluation failed')
    result = body.result
    return result?.id ?? ''
  }, { timeout: 20_000 }).not.toBe('')

  expect(result).toBeDefined()
  expect(result!.score).toBeGreaterThanOrEqual(0)
  expect(result!.score).toBeLessThanOrEqual(100)
  return result!
}

export async function createPublishedGeneralRubric(request: APIRequestContext) {
  const { token } = await apiLogin(request, 'faculty')
  const headers = { Authorization: `Bearer ${token}` }
  const suffix = Date.now()
  const name = `E2E general history rubric ${suffix}`
  const created = await request.post(`${API_BASE}/rubrics`, {
    headers,
    data: {
      slug: `e2e-general-history-${suffix}`,
      name,
      description: 'General-purpose fixture without case-specific red-flag references.',
      criteria: [{
        id: `e2e-general-${suffix}`,
        name: 'Focused history taking',
        description: 'Elicits a focused, patient-centred clinical history.',
        weight: 100,
        critical: false,
        redFlagIds: [],
        anchors: [
          { score: 0, label: 'Not demonstrated', description: 'No relevant history-taking behaviour is demonstrated.' },
          { score: 1, label: 'Emerging', description: 'Some relevant questions are asked, with major omissions.' },
          { score: 2, label: 'Developing', description: 'Most relevant questions are asked, with minor omissions.' },
          { score: 3, label: 'Proficient', description: 'A focused and patient-centred history is elicited comprehensively.' },
        ],
      }],
    },
  })
  await expectApiOk(created, 'create general rubric fixture')
  const { id } = await created.json() as { id: number }
  const published = await request.post(`${API_BASE}/rubrics/${id}/publish`, { headers })
  await expectApiOk(published, 'publish general rubric fixture')
  return { id: String(id), name }
}

export async function enterWorkspace(page: Page, role: 'student' | 'faculty') {
  await page.goto('/')
  const label = role === 'student' ? /Enter as Student/i : /Enter as Faculty/i
  if (role === 'faculty') await page.getByLabel('Faculty access code').fill(FACULTY_ACCESS_CODE)
  await page.getByRole('button', { name: label }).click()
  await expect(page).toHaveURL(new RegExp(`/${role}/?$`))
}
