<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Search } from '@lucide/vue'
import { api, apiError } from '@/services/api'
import type { EvaluationResult } from '@/types'
import StatusPill from '@/components/StatusPill.vue'
import { useLocaleStore } from '@/stores/locale'

const locale = useLocaleStore()
const items = ref<EvaluationResult[]>([])
const loading = ref(true)
const error = ref('')
const query = ref('')
const review = ref<'all' | 'adjusted' | 'unadjusted'>('all')
const page = ref(0)
const pageSize = 25
const total = ref(0)
let searchTimer: number | undefined
let requestSequence = 0

function formatDate(value: string) {
  return new Date(value).toLocaleString(locale.locale === 'zh' ? 'zh-CN' : 'en-AU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

async function load() {
  const requestId = ++requestSequence
  loading.value = true
  error.value = ''
  try {
    const result = await api.getResults({
      limit: pageSize,
      offset: page.value * pageSize,
      query: query.value.trim() || undefined,
      review: review.value,
    })
    if (requestId !== requestSequence) return
    items.value = result.items
    total.value = result.total
  } catch (cause) {
    if (requestId !== requestSequence) return
    error.value = apiError(cause)
  } finally {
    if (requestId === requestSequence) loading.value = false
  }
}

function changePage(next: number) {
  page.value = next
  void load()
}

watch([query, review], () => {
  page.value = 0
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void load(), 300)
})
onMounted(() => void load())
onBeforeUnmount(() => { requestSequence += 1; if (searchTimer) window.clearTimeout(searchTimer) })
</script>

<template>
  <div class="page">
    <header class="page-header"><div><div class="page-eyebrow">{{ locale.t('Assessment review') }}</div><h1>{{ locale.t('Student results') }}</h1><p class="subtitle">{{ locale.t('Inspect complete transcripts, evidence and AI-generated formative assessments.') }}</p></div></header>
    <div class="filter-row">
      <div class="field result-search"><Search :size="16" aria-hidden="true"/><label class="sr-only" for="result-search">{{ locale.t('Search results') }}</label><input id="result-search" v-model="query" class="input" :placeholder="locale.t('Search results…')"></div>
      <label class="sr-only" for="result-review">{{ locale.t('Filter by review status') }}</label><select id="result-review" v-model="review" class="select"><option value="all">{{ locale.t('All reviews') }}</option><option value="adjusted">{{ locale.t('Educator adjusted') }}</option><option value="unadjusted">{{ locale.t('AI score only') }}</option></select>
    </div>
    <div v-if="loading" class="loading"><div class="spinner"></div></div>
    <section v-else-if="error" class="card empty" role="alert"><h2>{{ locale.t('Results could not be loaded.') }}</h2><p>{{ error }}</p><button class="button" @click="load">{{ locale.t('Retry') }}</button></section>
    <div v-else class="card table-wrap">
      <table class="data-table"><thead><tr><th>{{ locale.t('Student') }}</th><th>{{ locale.t('Case') }}</th><th>{{ locale.t('Completed') }}</th><th>{{ locale.t('Score') }}</th><th>{{ locale.t('Level') }}</th><th>{{ locale.t('Review') }}</th><th><span class="sr-only">{{ locale.t('Open result') }}</span></th></tr></thead><tbody><tr v-for="result in items" :key="result.id"><td>{{ result.studentName }}</td><td><RouterLink :to="`/faculty/results/${result.id}`">{{ result.caseTitle }}</RouterLink></td><td>{{ formatDate(result.completedAt ?? result.createdAt) }}</td><td><strong>{{ result.teacherScore ?? result.score }}</strong> / 100</td><td><StatusPill :value="result.level"/></td><td><StatusPill :value="result.adjusted ? 'Adjusted' : 'AI assessed'"/></td><td><RouterLink :to="`/faculty/results/${result.id}`" :aria-label="`${locale.t('Review')} ${result.caseTitle}, ${result.studentName}`"><ChevronRight :size="17"/></RouterLink></td></tr></tbody></table>
      <div v-if="!items.length" class="empty"><Search/><h3>{{ locale.t('No matching results') }}</h3><p>{{ locale.t(query || review !== 'all' ? 'Adjust the search or review filter.' : 'Completed, evaluated attempts will appear here.') }}</p></div>
      <nav v-if="total > pageSize" class="pagination" :aria-label="locale.t('Results pages')"><button class="button button--secondary button--sm" :disabled="page === 0" @click="changePage(page - 1)"><ChevronLeft :size="16"/>{{ locale.t('Previous') }}</button><span>{{ locale.t('Page') }} {{ page + 1 }} / {{ Math.ceil(total / pageSize) }} · {{ total }} {{ locale.t('results') }}</span><button class="button button--secondary button--sm" :disabled="(page + 1) * pageSize >= total" @click="changePage(page + 1)">{{ locale.t('Next') }}<ChevronRight :size="16"/></button></nav>
    </div>
  </div>
</template>

<style scoped>
.result-search{position:relative}.result-search>svg{position:absolute;left:12px;top:14px;color:var(--muted);z-index:1}.result-search .input{padding-left:36px}.pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px}.pagination span{color:var(--muted);font-size:11px}@media(max-width:600px){.pagination{align-items:stretch;flex-direction:column}.pagination .button{width:100%}.pagination span{text-align:center}}
</style>
