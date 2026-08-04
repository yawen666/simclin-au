import { expect, test } from '@playwright/test'
import { API_BASE, apiLogin, enterWorkspace, expectApiOk } from './helpers'

test.describe('role protection', () => {
  test('protected routes redirect anonymous and wrong-role browser sessions', async ({ page }) => {
    await page.goto('/student/cases')
    await expect(page).toHaveURL(/\/?\?next=\/student\/cases$/)
    await expect(page.getByText('Choose your workspace')).toBeVisible()

    await enterWorkspace(page, 'student')
    await page.goto('/faculty/cases')
    await expect(page).toHaveURL(/\/?\?next=\/faculty\/cases$/)
    await expect(page.getByText('Choose your workspace')).toBeVisible()
  })

  test('backend rejects faculty-only and student-only actions for the wrong role', async ({ request }) => {
    const student = await apiLogin(request, 'student')
    const createCase = await request.post(`${API_BASE}/cases`, {
      headers: { Authorization: `Bearer ${student.token}` },
      data: {
        slug: 'forbidden-case', title: 'Forbidden case', specialty: 'Medicine', setting: 'Clinic',
        summary: '', difficulty: 'Foundation', estimatedMinutes: 10, content: {},
      },
    })
    expect(createCase.status()).toBe(403)

    const faculty = await apiLogin(request, 'faculty')
    const startSession = await request.post(`${API_BASE}/sessions`, {
      headers: { Authorization: `Bearer ${faculty.token}` },
      data: { caseId: 1 },
    })
    expect(startSession.status()).toBe(403)

    const health = await request.get(`${API_BASE}/health`)
    await expectApiOk(health, 'health check')
    expect(await health.json()).toMatchObject({ status: 'ok', aiProvider: 'mock', database: 'ok' })
  })

  test('open demo mode grants faculty access without shipping a frontend secret', async ({ request }) => {
    const login = await request.post(`${API_BASE}/auth/demo`, { data: { role: 'faculty' } })
    await expectApiOk(login, 'open demo faculty access')
    expect(await login.json()).toMatchObject({ user: { role: 'faculty', name: 'Dr Sarah Chen' } })

    const health = await request.get(`${API_BASE}/health`)
    await expectApiOk(health, 'open demo health check')
    expect(await health.json()).toMatchObject({
      facultyAccessProtected: false,
      facultyAccessMode: 'open-demo',
    })
  })

  test('backend blocks incomplete case publication and archiving an in-use rubric', async ({ request }) => {
    const faculty = await apiLogin(request, 'faculty')
    const headers = { Authorization: `Bearer ${faculty.token}` }
    const created = await request.post(`${API_BASE}/cases`, {
      headers,
      data: {
        slug: `incomplete-e2e-${Date.now()}`,
        title: 'Incomplete E2E case',
        specialty: 'General Medicine',
        setting: 'Clinic',
        summary: 'Intentionally incomplete publication fixture.',
        difficulty: 'Year 3',
        estimatedMinutes: 10,
        content: {},
        rubricId: 1,
      },
    })
    await expectApiOk(created, 'create incomplete case fixture')
    const { id } = await created.json() as { id: number }

    const publish = await request.post(`${API_BASE}/cases/${id}/publish`, { headers })
    expect(publish.status()).toBe(409)
    expect(await publish.json()).toMatchObject({ code: 'CASE_CONTENT_INCOMPLETE' })

    const archiveRubric = await request.post(`${API_BASE}/rubrics/1/archive`, { headers })
    expect(archiveRubric.status()).toBe(409)
    expect(await archiveRubric.json()).toMatchObject({ code: 'RUBRIC_IN_USE' })
  })
})
