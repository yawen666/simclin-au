<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { CalendarDays, ChevronRight, Clock3, History, RefreshCw } from '@lucide/vue'
import { api, apiError, unpack } from '@/services/api'
import type { ClinicalSession } from '@/types'
import StatusPill from '@/components/StatusPill.vue'
import ScoreRing from '@/components/ScoreRing.vue'
import { useLocaleStore } from '@/stores/locale'

const route = useRoute()
const locale = useLocaleStore()
const sessions = ref<ClinicalSession[]>([])
const loading = ref(true)
const error = ref('')
const noticeKey = ref(route.query.evaluation === 'started'
  ? 'Your consultation has ended. Feedback is being generated in the background; you can leave this page and return later.'
  : '')
const notice = computed(() => noticeKey.value ? locale.t(noticeKey.value) : '')
const status = ref('all')
const retryingId = ref('')
const filtered = computed(() => sessions.value.filter((session) => status.value === 'all' || session.status === status.value))
let pollTimer: number | undefined
let waitingObserved = false

function schedulePoll() {
  if (pollTimer) window.clearTimeout(pollTimer)
  if (sessions.value.some((session) => session.status === 'evaluating')) {
    waitingObserved = true
    pollTimer = window.setTimeout(() => void loadSessions(true), 4000)
  } else if (waitingObserved) {
    waitingObserved = false
    noticeKey.value = sessions.value.some((session) => session.status === 'evaluation_failed')
      ? 'One feedback report could not be generated. You can retry it below.'
      : 'Your formative feedback is ready. Select the completed attempt to review it.'
  }
}

async function loadSessions(silent = false) {
  if (!silent) loading.value = true
  try {
    const next = unpack(await api.getSessions())
    sessions.value = next
    error.value = ''
  } catch (cause) {
    error.value = apiError(cause)
  } finally {
    if (!silent) loading.value = false
    schedulePoll()
  }
}

async function retryEvaluation(session: ClinicalSession) {
  retryingId.value = session.id
  error.value = ''
  try {
    await api.completeSession(session.id)
    session.status = 'evaluating'
    session.evaluationStatus = 'queued'
    session.evaluationError = null
    noticeKey.value = 'Feedback generation restarted. You can leave this page and return later.'
    schedulePoll()
  } catch (cause) {
    error.value = apiError(cause, locale.t('Could not restart feedback generation.'))
  } finally {
    retryingId.value = ''
  }
}

function stateMessage(session: ClinicalSession) {
  if (session.status === 'evaluating') return locale.t('Generating evidence-linked feedback. This page refreshes automatically.')
  if (session.status === 'evaluation_failed') return locale.t('Feedback generation was interrupted. Retry when ready.')
  if (session.status === 'completed') return locale.t('Feedback ready to review.')
  return locale.t('Consultation still in progress.')
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(locale.locale === 'zh' ? 'zh-CN' : 'en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function durationMinutes(session: ClinicalSession) {
  return session.durationSeconds == null ? null : Math.round(session.durationSeconds / 60)
}

onMounted(() => void loadSessions())
onBeforeUnmount(() => { if (pollTimer) window.clearTimeout(pollTimer) })
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <div class="page-eyebrow">{{ locale.t('Your learning record') }}</div>
        <h1>{{ locale.t('Practice history') }}</h1>
        <p class="subtitle">{{ locale.t('Review previous consultations and return to evidence-linked feedback.') }}</p>
      </div>
    </header>

    <div v-if="notice" class="alert alert--success history-notice"><Clock3 :size="17"/> {{ notice }}</div>
    <div class="filter-row">
      <select v-model="status" class="select" :aria-label="locale.t('Filter practice attempts')">
        <option value="all">{{ locale.t('All attempts') }}</option>
        <option value="completed">{{ locale.t('Completed') }}</option>
        <option value="evaluating">{{ locale.t('Evaluating') }}</option>
        <option value="evaluation_failed">{{ locale.t('Evaluation failed') }}</option>
        <option value="active">{{ locale.t('In progress') }}</option>
      </select>
      <button class="button button--secondary button--sm" :disabled="loading" @click="loadSessions()">
        <RefreshCw :size="15"/> {{ locale.t('Refresh') }}
      </button>
    </div>

    <div v-if="loading" class="loading"><div class="spinner"></div></div>
    <section v-else-if="error && !sessions.length" class="card empty" role="alert"><h2>{{ locale.t('Practice history could not be loaded.') }}</h2><p>{{ error }}</p><button class="button" @click="loadSessions()">{{ locale.t('Retry') }}</button></section>
    <section v-else class="history-list">
      <div v-if="error" class="alert alert--error" role="alert">{{ error }}</div>
      <article v-for="item in filtered" :key="item.id" class="card history-row">
        <div class="history-icon"><History :size="19"/></div>
        <div class="history-copy">
          <h3>{{ item.caseTitle }}</h3>
          <span><CalendarDays :size="13"/>{{ formatDate(item.startedAt) }}<template v-if="durationMinutes(item) != null"> · {{ durationMinutes(item) }} {{ locale.t('min') }}</template></span>
          <b v-if="item.score != null" class="mobile-score">{{ locale.t('Score') }} {{ item.score }} / 100</b>
          <small>{{ stateMessage(item) }}</small>
        </div>
        <StatusPill :value="item.status"/>
        <ScoreRing v-if="item.score != null" :score="item.score" size="small"/>
        <RouterLink v-if="item.status === 'completed' && item.resultId" class="history-action" :to="`/student/feedback/${item.resultId}`" :aria-label="`${locale.t('View feedback')}: ${item.caseTitle}`">
          <ChevronRight :size="18"/>
        </RouterLink>
        <RouterLink v-else-if="item.status === 'active'" class="history-action" :to="`/student/consultation/${item.id}`" :aria-label="`${locale.t('Continue consultation')}: ${item.caseTitle}`">
          <ChevronRight :size="18"/>
        </RouterLink>
        <button v-else-if="item.status === 'evaluation_failed'" class="button button--secondary button--sm history-retry" :disabled="retryingId === item.id" @click="retryEvaluation(item)">
          <RefreshCw :size="14"/> {{ retryingId === item.id ? locale.t('Restarting…') : locale.t('Retry') }}
        </button>
        <span v-else class="history-progress" :aria-label="locale.t('Evaluation in progress')"><span class="spinner"></span></span>
      </article>

      <div v-if="!sessions.length" class="card empty">
        <History/>
        <h3>{{ locale.t('No practice attempts yet') }}</h3>
        <p>{{ locale.t('Choose a case to start your first consultation.') }}</p>
        <RouterLink class="button" to="/student/cases">{{ locale.t('Browse cases') }}</RouterLink>
      </div>
      <div v-else-if="!filtered.length" class="card empty"><History/><h3>{{ locale.t('No attempts match this filter') }}</h3><p>{{ locale.t('Choose another practice status or show all attempts.') }}</p></div>
    </section>
  </div>
</template>

<style scoped>
.history-notice{display:flex;align-items:center;gap:9px;margin-bottom:14px}.filter-row{justify-content:space-between}.history-list{display:grid;gap:10px}.history-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto auto;gap:17px;align-items:center;padding:15px 18px}.history-icon{width:42px;height:42px;display:grid;place-items:center;border-radius:11px;background:var(--green-soft);color:var(--green)}.history-copy{min-width:0}.history-copy h3{margin:0}.history-copy>span{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:10px}.history-copy small{display:block;margin-top:5px;color:#66756f;font-size:10px;white-space:normal}.mobile-score{display:none}.history-action{width:34px;height:34px;display:grid;place-items:center;border-radius:8px;color:var(--green)}.history-action:hover{background:var(--green-soft)}.history-progress{width:34px;height:34px;display:grid;place-items:center}.history-progress .spinner{width:18px;height:18px}.history-retry{white-space:nowrap}
@media(max-width:700px){.history-row{grid-template-columns:auto minmax(0,1fr) auto}.history-row .score-ring{display:none}.mobile-score{display:block;margin-top:3px;color:var(--green);font-size:10px}.history-row .status-pill{grid-column:2}.history-row>.history-action,.history-row>.history-progress,.history-row>.history-retry{grid-row:1/3;grid-column:3}.history-copy small{padding-right:4px}}
</style>
