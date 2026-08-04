import { expect, test } from '@playwright/test'

test('mobile student can navigate the core consultation and feedback loop', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Build clinical confidence/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Enter as Student/i })).toBeVisible()
  await page.getByRole('button', { name: /Enter as Student/i }).click()

  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible()
  await page.getByRole('link', { name: 'Case library' }).click()

  await expect(page.getByRole('heading', { name: 'Case library' })).toBeVisible()
  expect(await page.locator('.case-card').count()).toBeGreaterThanOrEqual(5)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)

  await page.locator('.case-card').filter({ hasText: 'Pressure in my chest' }).click()
  await expect(page.getByRole('heading', { name: 'Pressure in my chest' })).toBeVisible()
  await page.getByRole('button', { name: /Begin consultation/i }).click()

  await expect(page).toHaveURL(/\/student\/consultation\/\d+/)
  const patientMessages = page.locator('.message--patient .message__bubble')
  await expect(patientMessages).toHaveCount(1)
  const question = 'Hello, I am a medical student. What brought you in today?'
  await page.getByRole('textbox', { name: 'Question for the simulated patient' }).fill(question)
  await page.getByRole('button', { name: 'Send question' }).click()
  await expect(page.locator('.message--student .message__bubble')).toContainText(question)
  await expect(patientMessages).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)

  await page.getByRole('button', { name: 'End consultation' }).click()
  const endDialog = page.getByRole('alertdialog', { name: 'End consultation?' })
  await expect(endDialog).toBeVisible()
  await endDialog.getByRole('button', { name: 'End and generate feedback' }).click()

  await expect(page).toHaveURL(/\/student\/history\?evaluation=started&session=\d+/)
  const attempt = page.locator('.history-row').filter({ hasText: 'Pressure in my chest' }).first()
  await expect(attempt).toContainText(/completed/i, { timeout: 25_000 })
  await attempt.getByRole('link', { name: /View feedback/ }).click()
  await expect(page).toHaveURL(/\/student\/feedback\/\d+/)
  await expect(page.getByText('Formative feedback')).toBeVisible()
  await expect(page.getByText('Performance by domain')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
})
