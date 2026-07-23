import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ScoreRing from './ScoreRing.vue'

describe('ScoreRing', () => {
  it('renders a score with an accessible level', () => {
    const wrapper = mount(ScoreRing, { props: { score: 76 } })
    expect(wrapper.text()).toContain('76')
    expect(wrapper.attributes('aria-label')).toBe('76 out of 100, Competent')
    expect(wrapper.attributes('style')).toContain('--score: 76')
  })
})
