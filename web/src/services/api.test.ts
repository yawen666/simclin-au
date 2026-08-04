import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import type { ClinicalCase } from '@/types'

function canonicalCase(overrides: Partial<ClinicalCase> = {}): ClinicalCase {
  return {
    id: '27',
    title: 'Canonical case',
    subtitle: 'A canonical write response.',
    specialty: 'General Medicine',
    setting: 'General practice',
    difficulty: 'Year 3',
    durationMinutes: 10,
    status: 'draft',
    version: 2,
    task: 'Take a focused history.',
    learningObjectives: [],
    atomicFacts: [{
      id: 'history.onset',
      label: 'Onset',
      value: 'The symptom began today.',
      category: 'presenting_complaint',
      disclosureLevel: 'direct_question',
      triggers: [],
    }],
    redFlags: [{ id: 'safety.ongoing', label: 'Ongoing symptoms', linkedFactIds: ['history.onset'] }],
    ...overrides,
  }
}

describe('case write API contract', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses the canonical PATCH response without a follow-up GET and trims structured IDs', async () => {
    const patch = vi.spyOn(api.http, 'patch').mockResolvedValue({ data: canonicalCase() } as never)
    const get = vi.spyOn(api.http, 'get')

    const result = await api.updateCase('27', {
      ...canonicalCase(),
      atomicFacts: [{
        id: '  history.onset  ',
        label: 'Onset',
        value: 'The symptom began today.',
        category: 'presenting_complaint',
        disclosureLevel: 'direct_question',
      }],
      redFlags: [{
        id: '  safety.ongoing  ',
        label: 'Ongoing symptoms',
        linkedFactIds: [' history.onset ', 'history.onset'],
      }],
    })

    expect(get).not.toHaveBeenCalled()
    expect(result).toMatchObject({ id: '27', version: 2, title: 'Canonical case' })
    const payload = patch.mock.calls[0]?.[1] as {
      content: { caseData: { atomicFacts: Array<{ id: string }>; redFlags: Array<{ id: string; linkedFactIds: string[] }> } }
    }
    expect(payload.content.caseData.atomicFacts[0].id).toBe('history.onset')
    expect(payload.content.caseData.redFlags[0]).toMatchObject({
      id: 'safety.ongoing',
      linkedFactIds: ['history.onset'],
    })
  })

  it('uses the canonical POST response without fetching the new draft', async () => {
    const post = vi.spyOn(api.http, 'post').mockResolvedValue({ data: canonicalCase({ version: 1 }) } as never)
    const get = vi.spyOn(api.http, 'get')

    const result = await api.createCase(canonicalCase({ id: '', version: 1 }))

    expect(post).toHaveBeenCalledOnce()
    expect(get).not.toHaveBeenCalled()
    expect(result).toMatchObject({ id: '27', version: 1 })
  })
})
