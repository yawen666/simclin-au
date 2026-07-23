import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RubricEditor from './RubricEditor.vue'

const { getRubrics, updateRubric } = vi.hoisted(() => ({ getRubrics: vi.fn(), updateRubric: vi.fn() }))
vi.mock('@/services/api', () => ({
  api: { getRubrics, updateRubric, createRubric: vi.fn(), rubricAction: vi.fn() },
  unpack: (value: { items: unknown[] }) => value.items,
  apiError: () => 'API error',
}))

describe('RubricEditor', () => {
  beforeEach(() => {
    getRubrics.mockResolvedValue({
      items: [{
        id: '1', name: 'History-taking rubric', version: 1, publishedVersion: 1, status: 'published',
        criteria: Array.from({ length: 7 }, (_, index) => ({
          id: `domain-${index + 1}`, name: `Domain ${index + 1}`, description: '', weight: index === 6 ? 16 : 14,
          redFlagIds: index === 0 ? ['chest.hpi.01', 'chest.assoc.02'] : [],
          anchors: [0, 1, 2, 3].map((score) => ({ score, label: `Level ${score}`, description: '' })),
        })),
      }],
    })
  })

  it('clones and displays a selected reactive rubric without a DataCloneError', async () => {
    const wrapper = mount(RubricEditor)
    await flushPromises()
    expect(wrapper.findAll('.criterion')).toHaveLength(7)
    expect(wrapper.text()).toContain('History-taking rubric')
  })

  it('maps comma-separated red flag IDs back to an array when saving', async () => {
    updateRubric.mockResolvedValue({ id: '1' })
    const wrapper = mount(RubricEditor)
    await flushPromises()
    const input = wrapper.get('input[aria-label="Red flag fact IDs for Domain 1"]')
    expect(input.element.getAttribute('value') || (input.element as HTMLInputElement).value).toContain('chest.hpi.01')
    await input.setValue('chest.hpi.01, chest.red.01')
    await wrapper.get('.rubric-actions .button:last-child').trigger('click')
    await flushPromises()
    const payload = updateRubric.mock.calls[0]?.[1]
    expect(payload.criteria[0].redFlagIds).toEqual(['chest.hpi.01', 'chest.red.01'])
  })
})
