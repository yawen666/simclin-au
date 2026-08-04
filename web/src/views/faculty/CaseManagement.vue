<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Archive, Copy, Edit3, Eye, FilePlus2, Search, Send } from '@lucide/vue'
import { api, apiError, unpack } from '@/services/api'
import type { ClinicalCase } from '@/types'
import StatusPill from '@/components/StatusPill.vue'
import { useLocaleStore } from '@/stores/locale'

const locale = useLocaleStore()
const cases = ref<ClinicalCase[]>([])
const loading = ref(true)
const busy = ref('')
const error = ref('')
const notice = ref('')
const query = ref('')
const status = ref('all')
const filtered = computed(() => cases.value.filter(item => (status.value === 'all' || item.status === status.value) && `${item.title} ${item.specialty}`.toLowerCase().includes(query.value.toLowerCase())))

async function load() { cases.value = unpack(await api.getCases()); error.value = '' }

onMounted(async () => {
  try { await load() }
  catch (cause) { error.value = apiError(cause) }
  finally { loading.value = false }
})

async function action(item: ClinicalCase, next: 'publish' | 'archive' | 'duplicate') {
  if (busy.value) return
  if (next === 'archive' && !window.confirm(locale.t('Archive this published case? Existing attempts will keep their saved version.'))) return
  busy.value = `${item.id}-${next}`
  error.value = ''
  notice.value = ''
  try {
    await api.caseAction(item.id, next)
    await load()
    notice.value = next === 'duplicate' ? 'Case copied as a new draft.' : `Case ${next === 'publish' ? 'published' : 'archived'} successfully.`
  } catch (cause) {
    error.value = apiError(cause)
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <div class="page">
    <header class="page-header"><div><div class="page-eyebrow">{{ locale.t('Clinical content') }}</div><h1>{{ locale.t('Case management') }}</h1><p class="subtitle">{{ locale.t('Create, version, preview and publish structured AI patient cases.') }}</p></div><RouterLink class="button" to="/faculty/cases/new"><FilePlus2 :size="17"/>{{ locale.t('New case') }}</RouterLink></header>
    <div class="filter-row"><div class="field" style="position:relative"><Search :size="16" style="position:absolute;left:12px;top:14px;color:#84918c"/><input v-model="query" class="input" style="padding-left:36px" :placeholder="locale.t('Search cases…')" :aria-label="locale.t('Search cases')"></div><select v-model="status" class="select" :aria-label="locale.t('Filter cases by status')"><option value="all">{{ locale.t('All statuses') }}</option><option value="draft">{{ locale.t('Draft') }}</option><option value="published">{{ locale.t('Published') }}</option><option value="archived">{{ locale.t('Archived') }}</option></select></div>
    <div v-if="notice" class="alert alert--success" role="status">{{ locale.t(notice) }}</div>
    <div v-if="loading" class="loading"><div class="spinner"></div></div>
    <section v-else-if="error && !cases.length" class="card empty" role="alert"><h2>{{ locale.t('Case management could not be loaded.') }}</h2><p>{{ error }}</p><button class="button" @click="load">{{ locale.t('Retry') }}</button></section>
    <div v-else class="card table-wrap" :aria-busy="Boolean(busy)"><div v-if="error" class="alert alert--error" role="alert">{{ error }}</div><table class="data-table"><thead><tr><th>{{ locale.t('Case') }}</th><th>{{ locale.t('Specialty') }}</th><th>{{ locale.t('Status') }}</th><th>{{ locale.t('Version') }}</th><th>{{ locale.t('Attempts') }}</th><th style="text-align:right">{{ locale.t('Actions') }}</th></tr></thead><tbody><tr v-for="item in filtered" :key="item.id"><td><RouterLink :to="`/faculty/cases/${item.id}/edit`">{{ item.title }}</RouterLink><br><small>{{ item.subtitle }}</small></td><td>{{ locale.t(item.specialty) }}</td><td><StatusPill :value="item.status"/></td><td>v{{ item.version }}</td><td>{{ item.attempts ?? 0 }}</td><td><div class="actions"><RouterLink class="button button--link button--sm" :to="`/faculty/cases/${item.id}/edit`" :title="locale.t('Edit')" :aria-label="`${locale.t('Edit')}: ${item.title}`"><Edit3 :size="15"/></RouterLink><RouterLink class="button button--link button--sm" :to="`/faculty/cases/${item.id}/preview`" :title="locale.t('Preview')" :aria-label="`${locale.t('Preview')}: ${item.title}`"><Eye :size="15"/></RouterLink><button class="button button--link button--sm" :title="locale.t('Duplicate')" :aria-label="`${locale.t('Duplicate')}: ${item.title}`" :disabled="Boolean(busy)" @click="action(item, 'duplicate')"><Copy :size="15"/></button><button v-if="item.status === 'draft'" class="button button--link button--sm" :title="locale.t('Publish')" :aria-label="`${locale.t('Publish')}: ${item.title}`" :disabled="Boolean(busy)" @click="action(item, 'publish')"><Send :size="15"/></button><button v-if="item.status === 'published'" class="button button--link button--sm" :title="locale.t('Archive')" :aria-label="`${locale.t('Archive')}: ${item.title}`" :disabled="Boolean(busy)" @click="action(item, 'archive')"><Archive :size="15"/></button></div></td></tr></tbody></table><div v-if="!filtered.length" class="empty"><Search/><h3>{{ locale.t('No matching cases') }}</h3><p>{{ locale.t('Create a new case or adjust your filters.') }}</p></div></div>
  </div>
</template>
