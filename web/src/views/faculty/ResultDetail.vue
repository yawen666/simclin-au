<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import { ArrowLeft, Calculator, Check, MessageSquareQuote, Save } from '@lucide/vue'
import { api, apiError } from '@/services/api'
import type { EvaluationResult } from '@/types'
import ScoreRing from '@/components/ScoreRing.vue'
import StatusPill from '@/components/StatusPill.vue'
import MarkdownContent from '@/components/MarkdownContent.vue'
import TranscriptList from '@/components/TranscriptList.vue'
import { useLocaleStore } from '@/stores/locale'

const route = useRoute()
const locale = useLocaleStore()
const result = ref<EvaluationResult | null>(null)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const score = ref<number | undefined>()
const comment = ref('')
const highlightedTurn = ref<string | null>(null)
const savedReview = ref('')
const evidenceAnnouncement = ref('')
const reviewSnapshot = computed(() => JSON.stringify({ score: score.value, comment: comment.value.trim() }))
const reviewValid = computed(() => comment.value.trim().length >= 5 && comment.value.trim().length <= 1000 && score.value != null && score.value >= 0 && score.value <= 100)
const reviewDirty = computed(() => result.value != null && reviewSnapshot.value !== savedReview.value)

async function load() {
  loading.value = true
  error.value = ''
  try {
    result.value = await api.getResult(String(route.params.id))
    score.value = result.value.teacherScore ?? result.value.score
    comment.value = result.value.teacherComment || ''
    savedReview.value = reviewSnapshot.value
  } catch (e) {
    result.value = null
    error.value = apiError(e)
  } finally {
    loading.value = false
  }
}
onMounted(() => void load())

function beforeUnload(event: BeforeUnloadEvent) {
  if (!reviewDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}
window.addEventListener('beforeunload', beforeUnload)
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
onBeforeRouteLeave(() => !reviewDirty.value || window.confirm(locale.t('Discard unsaved review changes?')))
function focusTurn(turnId: string) {
  highlightedTurn.value = turnId
  nextTick(() => {
    const target = document.getElementById(`review-turn-${turnId}`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target?.focus({ preventScroll: true })
    evidenceAnnouncement.value = locale.t('Transcript evidence focused.')
  })
  window.setTimeout(() => { if (highlightedTurn.value === turnId) highlightedTurn.value = null }, 2600)
}
function evidenceStatusLabel(status?: string) {
  if (status === 'covered') return locale.t('Covered')
  if (status === 'asked_no_credit') return locale.t('Asked, evidence insufficient')
  return locale.t('Not asked')
}
async function save() {
  if (!result.value || !reviewValid.value || !reviewDirty.value) return
  saving.value = true; error.value = ''; notice.value = ''
  try { result.value = await api.overrideResult(result.value.id, { score: score.value, comment: comment.value }); savedReview.value = reviewSnapshot.value; notice.value = 'Educator review saved with an audit record.' }
  catch (e) { error.value = apiError(e) } finally { saving.value = false }
}
</script>

<template>
  <div class="page"><RouterLink class="text-button" to="/faculty/results"><ArrowLeft :size="16"/> {{ locale.t('Student results') }}</RouterLink>
    <div v-if="loading" class="loading" role="status"><div class="spinner"></div><span class="sr-only">{{ locale.t('Loading') }}</span></div><section v-else-if="error && !result" class="card empty" role="alert"><h2>{{ locale.t('The result could not be loaded.') }}</h2><p>{{ error }}</p><button class="button" type="button" @click="load">{{ locale.t('Try again') }}</button></section>
    <template v-else-if="result">
      <header class="result-head"><div><div class="page-eyebrow">{{ locale.t('Attempt review') }}</div><h1>{{ result.caseTitle }}</h1><p class="subtitle">{{ result.studentName }} · {{ new Date(result.completedAt ?? result.createdAt).toLocaleString(locale.locale === 'zh' ? 'zh-CN' : 'en-AU', { dateStyle: 'medium', timeStyle: 'short' }) }}</p></div><div class="result-head__score"><div v-if="result.adjusted" class="score-comparison"><span>{{ locale.t('AI score') }} <b>{{ result.aiScore ?? result.score }}</b></span><i>→</i><span>{{ locale.t('Final score') }} <b>{{ result.teacherScore ?? result.score }}</b></span></div><ScoreRing :score="result.teacherScore ?? result.score"/><StatusPill :value="result.adjusted ? 'Adjusted' : result.level"/></div></header>
      <div v-if="error" class="alert alert--error" role="alert">{{ error }}</div><div v-if="notice" class="alert alert--success" role="status"><Check :size="16"/> {{ locale.t(notice) }}</div><p class="sr-only" aria-live="polite">{{ evidenceAnnouncement }}</p>
      <div class="review-layout"><div class="review-main">
        <section class="card card--padded scoring-audit"><div><Calculator :size="18"/><h2>{{ locale.t('Scoring audit') }}</h2></div><p>Σ ({{ locale.t('domain score') }} ÷ 3 × {{ locale.t('domain weight') }}) = <b>{{ result.uncappedScore ?? result.aiScore ?? result.score }} / 100</b></p><p>{{ locale.t(result.scoringRoundingRule || 'Final total rounded to the nearest whole point before any safety cap') }}.</p><p v-if="result.capApplied != null" class="scoring-audit__cap">{{ locale.t('Safety score ceiling') }}: {{ result.capApplied }}/100 · {{ locale.t(result.scoreCapReason || '') }}</p><small>{{ locale.t('Domain weights total 100%. Positive scores require cited student-turn evidence. Educator adjustment requires an audit rationale.') }}</small></section>
        <section class="card card--padded"><div class="section-title"><div><h2>{{ locale.t('Assessment evidence') }}</h2><span class="subtitle">{{ locale.t('Select a quote to locate the original turn in the transcript.') }}</span></div></div><article v-for="criterion in result.criteria" :key="criterion.criterionId" class="evidence"><div class="evidence-head"><span><b>{{ criterion.name }}</b><small :class="['evidence-status', `evidence-status--${criterion.evidenceStatus ?? 'not_asked'}`]">{{ evidenceStatusLabel(criterion.evidenceStatus) }}</small></span><strong>{{ criterion.score }} / {{ criterion.maxScore }} · {{ criterion.weight }}% · {{ criterion.weightedScore.toFixed(1) }} {{ locale.t('points') }}</strong></div><MarkdownContent :content="criterion.feedback"/><p v-if="!criterion.evidence.length" class="evidence-empty">{{ evidenceStatusLabel(criterion.evidenceStatus) }}</p><button v-for="e in criterion.evidence" :key="e.turnId" type="button" class="evidence-quote" @click="focusTurn(e.turnId)"><MessageSquareQuote :size="14"/> “{{ e.quote }}” <cite>{{ locale.t('View in transcript') }}</cite></button></article></section>
        <section class="card card--padded transcript"><h2>{{ locale.t('Consultation transcript') }}</h2><TranscriptList :turns="result.transcript" :highlighted-turn="highlightedTurn" id-prefix="review-turn" viewer="faculty"/></section>
      </div><aside><form class="card card--padded override" @submit.prevent="save"><h2>{{ locale.t('Educator review') }}</h2><p>{{ locale.t('Adjust the score only when the transcript evidence does not support the automated assessment.') }}</p><p class="review-visibility">{{ locale.t('The final score and this comment are visible to the student.') }}</p><div class="field"><label for="review-score">{{ locale.t('Final score / 100') }}</label><input id="review-score" v-model.number="score" class="input" type="number" min="0" max="100" required></div><div class="field"><label for="review-comment">{{ locale.t('Comment and rationale') }}</label><textarea id="review-comment" v-model="comment" class="textarea" minlength="5" maxlength="1000" required :placeholder="locale.t('Required rationale for an adjusted score')"></textarea><small :style="{ color: comment.trim().length && comment.trim().length < 5 ? 'var(--red)' : '' }">{{ comment.trim().length }} / 1000 {{ locale.t('characters · minimum 5') }}</small></div><button class="button" :disabled="saving || !reviewValid || !reviewDirty"><Save :size="16"/> {{ saving ? locale.t('Saving…') : locale.t('Save review') }}</button></form></aside></div>
    </template>
  </div>
</template>

<style scoped>
.result-head{display:flex;justify-content:space-between;align-items:center;gap:25px;margin:20px 0 30px}.result-head__score{display:flex;align-items:center;gap:15px}.result-head__score .score-ring{width:105px}.score-comparison{display:flex;align-items:center;gap:8px;font-size:10px;color:var(--muted)}.score-comparison span{display:grid}.score-comparison b{font-size:18px;color:var(--ink)}.score-comparison i{font-style:normal;color:var(--green)}.review-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:18px;margin-top:18px}.review-main{display:grid;gap:18px}.review-layout aside{position:sticky;top:25px;height:fit-content}.scoring-audit>div{display:flex;align-items:center;gap:8px;color:var(--green)}.scoring-audit h2{margin:0;color:var(--ink)}.scoring-audit p{font-size:12px}.scoring-audit small{color:var(--muted);font-size:10px}.scoring-audit__cap{padding:8px 10px;border-radius:8px;background:#fff5e4;color:#875c26}.evidence{padding:16px 0;border-bottom:1px solid var(--line)}.evidence-head{display:flex;justify-content:space-between;align-items:center;gap:12px}.evidence-head>span{display:flex;align-items:center;gap:8px}.evidence-head strong{color:var(--green);font-size:11px;text-align:right}.evidence-status{font-size:9px;padding:2px 7px;border-radius:20px;font-weight:500;background:#eef2f0}.evidence-status--covered{color:#2e765b;background:#e7f3ed}.evidence-status--asked_no_credit{color:#996521;background:#fff3df}.evidence-status--not_asked{color:#687570;background:#eef1f0}.evidence-empty{font-size:12px;color:var(--muted);margin:10px 0}.evidence-quote{display:block;width:100%;margin:8px 0 0;padding:10px;border:0;border-left:3px solid var(--sage);background:#f5f8f6;text-align:left;font-size:11px;cursor:pointer;color:#596761}.evidence-quote:hover{background:#eaf3ee}.evidence-quote svg{vertical-align:middle;margin-right:5px}.evidence-quote cite{color:#687570}.transcript{display:grid;gap:14px}.transcript h2{margin:0}.override{display:grid;gap:14px}.override h2{margin:0}.override>p{color:var(--muted);font-size:11px}.override .review-visibility{padding:8px 10px;border-radius:8px;background:#eef5f2;color:var(--green-dark)}@media(max-width:850px){.review-layout{grid-template-columns:1fr}.review-layout aside{position:static;grid-row:1}.result-head{align-items:flex-start;flex-direction:column}.result-head__score{flex-wrap:wrap}.result-head__score .score-ring{width:85px}}
</style>
