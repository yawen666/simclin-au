import { expect, test } from '@playwright/test'
import { enterWorkspace } from './helpers'

test.describe('student and role entry', () => {
  test('settings button toggles the interface language and persists the choice', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: /中文/ }).click()
    await expect(page.getByText('以学生身份进入')).toBeVisible()
    await expect.poll(() => page.evaluate(() => localStorage.getItem('simclin-locale'))).toBe('zh')

    await page.getByRole('button', { name: /English/ }).click()
    await expect(page.getByRole('button', { name: /Enter as Student/ })).toBeVisible()
    await expect.poll(() => page.evaluate(() => localStorage.getItem('simclin-locale'))).toBe('en')
  })

  test('landing supports both built-in roles and clears the prior role', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle('SimClin AU')
    await expect(page.getByRole('heading', { name: /Build clinical confidence/i })).toBeVisible()
    await expect(page.getByText('No sign-in required for this preview')).toBeVisible()

    await page.getByRole('button', { name: /Enter as Student/i }).click()
    await expect(page).toHaveURL(/\/student\/?$/)
    await expect(page.getByText('Student workspace')).toBeVisible()
    await expect(page.getByRole('heading', { name: /Alex/ })).toBeVisible()
    await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('simclin-demo-token')))).toBe(true)

    await page.getByRole('button', { name: 'Switch role' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('simclin-demo-token'))).toBeNull()

    await page.getByRole('button', { name: /Enter as Faculty/i }).click()
    await expect(page).toHaveURL(/\/faculty\/?$/)
    await expect(page.getByRole('heading', { name: 'Teaching overview' })).toBeVisible()
    await expect(page.getByText('Faculty workspace').first()).toBeVisible()
  })

  test('student completes a streamed consultation and can reopen its feedback from history', async ({ page }) => {
    await enterWorkspace(page, 'student')
    await page.getByRole('link', { name: 'Case library' }).click()

    await expect(page.getByRole('heading', { name: 'Case library' })).toBeVisible()
    const caseCards = page.locator('.case-card')
    await expect(caseCards).toHaveCount(5)
    await expect(page.getByRole('link', { name: /Pressure in my chest/i })).toBeVisible()

    await page.getByRole('link', { name: /Pressure in my chest/i }).click()
    await expect(page.getByRole('heading', { name: 'Pressure in my chest' })).toBeVisible()
    await expect(page.getByText('Your task')).toBeVisible()
    await expect(page.getByText('Learning focus')).toBeVisible()
    await page.getByRole('button', { name: /Begin consultation/i }).click()

    await expect(page).toHaveURL(/\/student\/consultation\/\d+/)
    await expect(page.getByText('AI standardised patient · Formative practice')).toBeVisible()
    const patientMessages = page.locator('.message--patient .message__bubble')
    await expect(patientMessages).toHaveCount(1)

    const question = 'Hello, I am Alex, a medical student. Could you tell me what brought you in today?'
    await page.getByRole('textbox', { name: /Question for the (simulated )?patient/i }).fill(question)
    await page.getByRole('button', { name: 'Send question' }).click()
    await expect(page.locator('.message--student .message__bubble')).toContainText(question)
    await expect(patientMessages).toHaveCount(2)
    await expect(patientMessages.last()).toContainText('Thanks for asking.')

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'End consultation' }).click()
    await expect(page).toHaveURL(/\/student\/history\?evaluation=started&session=\d+/)
    await expect(page.getByRole('heading', { name: 'Practice history' })).toBeVisible()
    const generatedRow = page.locator('.history-row').filter({ hasText: 'Pressure in my chest' }).first()
    await expect(generatedRow).toContainText(/completed/i, { timeout: 20_000 })
    await generatedRow.getByRole('link', { name: 'View feedback' }).click()
    await expect(page).toHaveURL(/\/student\/feedback\/\d+/)
    await expect(page.getByText('Formative feedback')).toBeVisible()
    await expect(page.getByText('What you did well')).toBeVisible()
    await expect(page.getByText('Focus for next time')).toBeVisible()
    await expect(page.locator('.domain')).toHaveCount(7)
    await expect(page.locator('.domain').first()).toContainText(/\d(?:\.\d)? \/ 3/)
    await expect(page.locator('.domain').first().locator('.evidence-quote')).toContainText(question)
    await page.locator('.domain').first().locator('.evidence-quote').click()
    await expect(page.locator('.transcript-turn--highlight')).toContainText(question)

    await page.getByRole('link', { name: 'Practice history' }).first().click()
    await expect(page.getByRole('heading', { name: 'Practice history' })).toBeVisible()
    const completedRow = page.locator('.history-row').filter({ hasText: 'Pressure in my chest' }).first()
    await expect(completedRow).toContainText(/completed/i)
    await completedRow.getByRole('link', { name: 'View feedback' }).click()
    await expect(page).toHaveURL(/\/student\/feedback\/\d+/)
    await expect(page.getByText('Performance by domain')).toBeVisible()
  })
})
