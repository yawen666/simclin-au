<script setup lang="ts">
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import typescript from 'highlight.js/lib/languages/typescript'
import katex from 'katex'
import { computed } from 'vue'

const props = defineProps<{ content: string }>()
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('typescript', typescript)
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
}[character] ?? character))

const md: MarkdownIt = new MarkdownIt({
  html: false, linkify: true, breaks: true,
  highlight(code: string, language: string): string {
    if (language && hljs.getLanguage(language)) return `<pre><code class="hljs">${hljs.highlight(code, { language }).value}</code></pre>`
    return `<pre><code class="hljs">${escapeHtml(code)}</code></pre>`
  },
})

md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
  if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false
  const end = state.src.indexOf('$', state.pos + 1)
  if (end < 0) return false
  if (!silent) {
    const token = state.push('math_inline', 'math', 0)
    token.content = state.src.slice(state.pos + 1, end)
  }
  state.pos = end + 1
  return true
})
md.renderer.rules.math_inline = (tokens, index) => katex.renderToString(tokens[index]?.content ?? '', { throwOnError: false, output: 'html' })
const rendered = computed(() => md.render(props.content || ''))
</script>
<template><div class="markdown-content" v-html="rendered"></div></template>
