<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowRight, BookOpen, ChartNoAxesColumnIncreasing, CheckCircle2, ClipboardCheck, FilePlus2, Users } from '@lucide/vue'
import { api, apiError } from '@/services/api'
import type { Insights } from '@/types'
import StatusPill from '@/components/StatusPill.vue'
import { useLocaleStore } from '@/stores/locale'

const insights = ref<Insights | null>(null)
const loading = ref(true)
const error = ref('')
const locale = useLocaleStore()

function formatDate(value: string) { return new Date(value).toLocaleDateString(locale.locale === 'zh' ? 'zh-CN' : 'en-AU') }
function initials(value: string) { return value.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() }
async function load() {
  loading.value = true
  error.value = ''
  try { insights.value = await api.getInsights() }
  catch (cause) { error.value = apiError(cause) }
  finally { loading.value = false }
}
onMounted(() => void load())
</script>

<template>
  <div class="page"><header class="page-header"><div><div class="page-eyebrow">{{ locale.t('Faculty workspace') }}</div><h1>{{ locale.t('Teaching overview') }}</h1><p class="subtitle">{{ locale.t('Manage structured cases and monitor the quality of formative history-taking practice.') }}</p></div><RouterLink class="button" to="/faculty/cases/new"><FilePlus2 :size="17"/>{{ locale.t('New case') }}</RouterLink></header>
    <div v-if="loading" class="loading"><div class="spinner"></div></div>
    <section v-else-if="error" class="card empty" role="alert"><h2>{{ locale.t('The faculty dashboard could not be loaded.') }}</h2><p>{{ error }}</p><button class="button" @click="load">{{ locale.t('Retry') }}</button></section>
    <template v-else-if="insights"><section class="stats-grid"><div class="stat-card"><small>{{ locale.t('Published cases') }}</small><strong>{{ insights.stats.publishedCases }}</strong><span>{{ locale.t('Ready for practice') }}</span><BookOpen/></div><div class="stat-card"><small>{{ locale.t('Total attempts') }}</small><strong>{{ insights.stats.totalAttempts }}</strong><span>{{ locale.t('All demonstration activity') }}</span><Users/></div><div class="stat-card"><small>{{ locale.t('Completion rate') }}</small><strong>{{ insights.stats.completionRate }}%</strong><span>{{ locale.t('Started to evaluated') }}</span><CheckCircle2/></div><div class="stat-card"><small>{{ locale.t('Median score') }}</small><strong>{{ insights.stats.medianScore }}</strong><span>{{ locale.t('Formative score / 100') }}</span><ChartNoAxesColumnIncreasing/></div></section>
      <div class="faculty-grid"><section class="card card--padded"><div class="section-title"><h2>{{ locale.t('Recent results') }}</h2><RouterLink to="/faculty/results">{{ locale.t('View all') }}</RouterLink></div><div v-for="result in insights.recentResults.slice(0, 5)" :key="result.id" class="recent-row"><span class="recent-row__avatar">{{ initials(result.studentName) }}</span><div><b>{{ result.caseTitle }}</b><small>{{ formatDate(result.completedAt ?? result.createdAt) }}</small></div><StatusPill :value="result.adjusted ? 'Adjusted' : result.level"/><strong>{{ result.teacherScore ?? result.score }}</strong><RouterLink :to="`/faculty/results/${result.id}`" :aria-label="`${locale.t('Review')} ${result.caseTitle}, ${result.studentName}`"><ArrowRight :size="16"/></RouterLink></div><div v-if="!insights.recentResults.length" class="empty"><ClipboardCheck/><p>{{ locale.t('Completed attempts will appear here.') }}</p></div></section><aside class="card card--padded"><div class="section-title"><h2>{{ locale.t('Commonly missed') }}</h2><RouterLink to="/faculty/insights">{{ locale.t('Insights') }}</RouterLink></div><div v-for="item in insights.commonMisses.slice(0, 5)" :key="item.label" class="miss-row"><span>{{ item.label }}</span><b>{{ item.count }}</b></div><div v-if="!insights.commonMisses.length" class="empty"><p>{{ locale.t('More practice data is needed.') }}</p></div></aside></div>
    </template>
  </div>
</template>

<style scoped>
.faculty-grid{display:grid;grid-template-columns:1.45fr .75fr;gap:18px;margin-top:20px}.faculty-grid .section-title{margin-top:0}.recent-row{display:grid;grid-template-columns:auto 1fr auto 35px auto;gap:11px;align-items:center;padding:12px 0;border-bottom:1px solid #edf1ef}.recent-row__avatar{width:32px;height:32px;display:grid;place-items:center;border-radius:50%;background:var(--green-soft);color:var(--green);font-size:10px;font-weight:700}.recent-row div{display:grid}.recent-row b{font-size:11px}.recent-row small{font-size:9px;color:var(--muted)}.recent-row>strong{text-align:right;color:var(--green)}.miss-row{display:flex;justify-content:space-between;gap:14px;padding:12px 0;border-bottom:1px solid #edf1ef;font-size:12px}.miss-row span{color:#4f6059}.miss-row b{color:var(--amber)}@media(max-width:900px){.faculty-grid{grid-template-columns:1fr}}@media(max-width:520px){.recent-row{grid-template-columns:auto 1fr 30px auto}.recent-row .status-pill{display:none}}
</style>
