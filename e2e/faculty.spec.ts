import { expect, test } from '@playwright/test'
import { createCompletedAttempt, createPublishedGeneralRubric, enterWorkspace } from './helpers'

test.describe('faculty workspace', () => {
  test('faculty creates, previews, publishes, duplicates and archives a structured case', async ({ page, request }) => {
    const title = `E2E Palpitations ${Date.now()}`
    const rubric = await createPublishedGeneralRubric(request)
    await enterWorkspace(page, 'faculty')
    await page.getByRole('link', { name: 'Case management' }).click()

    await expect(page.getByRole('heading', { name: 'Case management' })).toBeVisible()
    await expect(page.locator('tbody tr')).toHaveCount(5)
    await page.getByRole('link', { name: 'New case' }).click()
    await expect(page.getByRole('heading', { name: 'Create a case' })).toBeVisible()

    const field = (label: string) => page.locator('.field').filter({ has: page.getByText(label, { exact: true }) })
    await field('Case title').locator('input').fill(title)
    await field('Student-facing subtitle').locator('input').fill('A focused history of intermittent palpitations and light-headedness.')
    await field('Specialty').locator('select').selectOption({ label: 'Cardiology / Emergency Medicine' })
    await field('Clinical setting').locator('select').selectOption({ label: 'General practice' })
    await field('Time allowed (minutes)').locator('input').fill('12')
    await field('Patient name').locator('input').fill('Morgan Taylor')
    await field('Age').locator('input').fill('34')
    await field('Presenting complaint').locator('textarea').fill('Intermittent racing heartbeat for three days, with one brief episode of light-headedness.')
    await field('Opening statement').locator('textarea').fill('My heart has been racing on and off, and it is starting to worry me.')
    await field('Patient fact').locator('textarea').fill('The racing heartbeat starts suddenly, lasts around five minutes and has happened four times in three days.')
    const factCard = page.locator('.fact-card').first()
    const factId = factCard.locator('.field').filter({ has: page.getByText('Stable fact ID', { exact: true }) }).locator('input')
    await factId.fill('  palpitations.onset  ')
    await page.getByRole('button', { name: 'Add red flag' }).click()
    const redFlagCard = page.locator('.red-flag-card').first()
    const redFlagId = redFlagCard.locator('.field').filter({ has: page.getByText('Red flag ID', { exact: true }) }).locator('input')
    await redFlagId.fill('  palpitations.safety.ongoing  ')
    await redFlagCard.locator('.field').filter({ has: page.getByText('Label', { exact: true }) }).locator('input').fill('Ongoing concerning palpitations')
    await redFlagCard.locator('.fact-links input[type="checkbox"]').check()
    await page.getByRole('button', { name: 'Add objective' }).click()
    await page.getByLabel('Learning objective 1').fill('Elicit the timing, triggers and associated symptoms of palpitations.')
    await page.locator('.editor-side select').selectOption({ label: `${rubric.name} · v1` })

    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByText('Draft saved.')).toBeVisible()
    await expect(page).toHaveURL(/\/faculty\/cases\/\d+\/edit/)
    await expect(factId).toHaveValue('palpitations.onset')
    await expect(redFlagId).toHaveValue('palpitations.safety.ongoing')
    await expect(redFlagCard.locator('.fact-links input[type="checkbox"]')).toBeChecked()

    await page.getByRole('link', { name: 'Preview' }).click()
    await expect(page).toHaveURL(/\/faculty\/cases\/\d+\/preview/)
    await expect(page.getByText('Educator preview')).toBeVisible()
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
    await expect(page.getByText('Student view')).toBeVisible()
    await expect(page.getByText('Morgan Taylor')).toBeVisible()
    await expect(page.getByText('Intermittent racing heartbeat for three days', { exact: false })).toBeVisible()
    await page.getByPlaceholder('Try a question, for example: When did it start?').fill('When did it start?')
    await page.getByRole('button', { name: 'Test patient' }).click()
    await expect(page.getByText('Patient response')).toBeVisible()
    await expect(page.locator('.ai-preview__facts li')).toHaveCount(1)
    await page.getByRole('link', { name: 'Back to editor' }).click()

    await page.getByRole('button', { name: 'Publish' }).click()
    await expect(page.getByText('Case published as a new immutable version.')).toBeVisible()

    await page.getByRole('link', { name: 'Case management' }).first().click()
    await page.getByPlaceholder('Search cases…').fill(title)
    const row = page.getByRole('row').filter({ hasText: title }).filter({ hasNotText: '(copy)' })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(/published/i)

    await row.getByTitle('Duplicate').click()
    await expect(page.getByText('Case copied as a new draft.')).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: `${title} (copy)` })).toContainText(/draft/i)

    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm')
      await dialog.accept()
    })
    await row.getByTitle('Archive').click()
    await expect(page.getByText('Case archived successfully.')).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: title }).filter({ hasNotText: '(copy)' })).toContainText(/archived/i)
  })

  test('faculty reviews transcript evidence and records an audited score override', async ({ page, request }) => {
    const result = await createCompletedAttempt(request)
    await enterWorkspace(page, 'faculty')
    await page.getByRole('link', { name: 'Results' }).click()

    await expect(page.getByRole('heading', { name: 'Student results' })).toBeVisible()
    const resultRow = page.getByRole('row').filter({ hasText: result.caseTitle }).first()
    await expect(resultRow).toContainText(`${result.score}`)
    await resultRow.getByRole('link', { name: result.caseTitle, exact: true }).click()

    await expect(page).toHaveURL(new RegExp(`/faculty/results/${result.id}$`))
    await expect(page.getByRole('heading', { name: result.caseTitle })).toBeVisible()
    await expect(page.getByText('Assessment evidence')).toBeVisible()
    await expect(page.getByText('Consultation transcript')).toBeVisible()
    await expect(page.locator('.evidence')).toHaveCount(7)

    const scoreField = page.locator('.field').filter({ has: page.getByText('Final score / 100', { exact: true }) })
    const commentField = page.locator('.field').filter({ has: page.getByText('Comment and rationale', { exact: true }) })
    await scoreField.locator('input').fill('88')
    await commentField.locator('textarea').fill('Transcript evidence supports a higher final score after educator review.')
    await page.getByRole('button', { name: 'Save review' }).click()
    await expect(page.getByText('Educator review saved with an audit record.')).toBeVisible()
    await expect(page.locator('.score-ring')).toContainText('88')

    await page.getByRole('link', { name: 'Student results' }).first().click()
    const adjustedRow = page.getByRole('row').filter({ hasText: result.caseTitle }).first()
    await expect(adjustedRow).toContainText('88')
    await expect(adjustedRow).toContainText('Adjusted')
  })

  test('faculty insights render aggregate metrics and charts from completed attempts', async ({ page, request }) => {
    await createCompletedAttempt(request, 2)
    await enterWorkspace(page, 'faculty')
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Insights' }).click()

    await expect(page.getByRole('heading', { name: 'Teaching insights' })).toBeVisible()
    const publishedCases = Number(await page.locator('.stat-card').filter({ hasText: 'Published cases' }).locator('strong').textContent())
    expect(publishedCases).toBeGreaterThanOrEqual(5)
    await expect(page.locator('.stat-card').filter({ hasText: 'Total attempts' }).locator('strong')).not.toHaveText('0')
    await expect(page.getByRole('heading', { name: 'Performance by domain' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Score distribution' })).toBeVisible()
    await expect(page.locator('canvas')).toHaveCount(2)
  })

  test('rubric editor exposes seven weighted domains and can save a version', async ({ page }) => {
    await enterWorkspace(page, 'faculty')
    await page.getByRole('link', { name: 'Rubrics' }).click()

    await expect(page.getByRole('heading', { name: 'Rubric editor' })).toBeVisible()
    await expect(page.locator('.criterion')).toHaveCount(7)
    await expect(page.locator('.weight-total')).toContainText('100%')
    const rubricName = page.locator('.rubric-head input').first()
    await rubricName.fill(`${await rubricName.inputValue()} E2E`)
    await page.getByRole('button', { name: 'Save new version' }).click()
    await expect(page.getByText('Rubric saved as a new version.')).toBeVisible()

    const newRubricName = `E2E communication rubric ${Date.now()}`
    await page.getByRole('button', { name: 'New rubric' }).click()
    await expect(page.locator('.criterion')).toHaveCount(1)
    await page.locator('.rubric-head input').first().fill(newRubricName)
    const newCriterion = page.locator('.criterion').first()
    await newCriterion.locator('input.input').first().fill('Patient-centred communication')
    await newCriterion.locator('textarea').fill('Uses clear, respectful and patient-centred communication throughout the consultation.')
    for (const [score, description] of [
      [0, 'No patient-centred communication behaviour is demonstrated.'],
      [1, 'Some respectful communication is demonstrated, with major omissions.'],
      [2, 'Communication is mostly respectful and clear, with minor omissions.'],
      [3, 'Communication is consistently clear, respectful and patient-centred.'],
    ] as const) {
      await newCriterion.getByRole('textbox', { name: `Score ${score} Description` }).fill(description)
    }
    await page.getByRole('button', { name: 'Create rubric' }).click()
    await expect(page.getByText('Rubric created.')).toBeVisible()

    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByText('Rubric published successfully.')).toBeVisible()
    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm')
      await dialog.accept()
    })
    await page.getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(page.getByText('Rubric archived successfully.')).toBeVisible()
  })
})
