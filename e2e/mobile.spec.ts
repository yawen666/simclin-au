import { expect, test } from '@playwright/test'

test('mobile student navigation and case catalogue remain usable', async ({ page }) => {
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
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
