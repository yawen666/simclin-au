import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test'

export const API_BASE = 'http://127.0.0.1:4000/api'

export async function expectApiOk(response: APIResponse, label: string): Promise<void> {
  if (response.ok()) return
  throw new Error(`${label} failed with ${response.status()}: ${await response.text()}`)
}

export async function apiLogin(request: APIRequestContext, role: 'student' | 'faculty') {
  const response = await request.post(`${API_BASE}/auth/demo`, { data: { role } })
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
  const completedBody = await completed.json() as {
    resultId: string
    result: { id: string; sessionId: string; caseTitle: string; score: number }
  }
  expect(completedBody.resultId).toBeTruthy()
  expect(completedBody.result.score).toBeGreaterThanOrEqual(0)
  expect(completedBody.result.score).toBeLessThanOrEqual(100)
  return completedBody.result
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
  await page.getByRole('button', { name: label }).click()
  await expect(page).toHaveURL(new RegExp(`/${role}/?$`))
}
