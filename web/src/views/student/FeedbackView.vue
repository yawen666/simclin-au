<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { AlertTriangle, ArrowLeft, Calculator, CheckCircle2, ChevronDown, MessageSquareQuote, RefreshCw, ShieldCheck, Sparkles, Target } from '@lucide/vue'
import { api, apiError } from '@/services/api'
import type { EvaluationResult } from '@/types'
import ScoreRing from '@/components/ScoreRing.vue'
import StatusPill from '@/components/StatusPill.vue'
import MarkdownContent from '@/components/MarkdownContent.vue'
import { useLocaleStore } from '@/stores/locale'

const route = useRoute()
const locale = useLocaleStore()
const result = ref<EvaluationResult | null>(null)
const loading = ref(true)
const error = ref('')
const openDomain = ref<string | null>(null)
const highlightedTurn = ref<string | null>(null)

onMounted(async () => {
  try { result.value = await api.getResult(String(route.params.id)); openDomain.value = result.value.criteria[0]?.criterionId || null }
  catch (e) { error.value = apiError(e) } finally { loading.value = false }
})

function focusTurn(turnId: string) {
  highlightedTurn.value = turnId
  nextTick(() => document.getElementById(`feedback-turn-${turnId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  window.setTimeout(() => { if (highlightedTurn.value === turnId) highlightedTurn.value = null }, 2600)
}
function evidenceStatusLabel(status?: string) {
  if (status === 'covered') return locale.t('Covered')
  if (status === 'asked_no_credit') return locale.t('Asked, evidence insufficient')
  return locale.t('Not asked')
}
</script>

<template>
  <div class="page"><RouterLink class="text-button" to="/student/history"><ArrowLeft :size="16"/> {{ locale.t('Practice history') }}</RouterLink>
    <div v-if="loading" class="loading"><div><div class="spinner"></div>{{ locale.t('Preparing your feedback…') }}</div></div>
    <div v-else-if="error" class="alert alert--error">{{ error }}</div>
    <template v-else-if="result">
      <header class="feedback-hero card"><ScoreRing :score="result.teacherScore ?? result.score"/><div><div class="page-eyebrow">{{ locale.t('Formative feedback') }}</div><h1>{{ result.caseTitle }}</h1><div class="feedback-level"><StatusPill :value="result.level"/><span v-if="result.adjusted">{{ locale.t('· Reviewed by educator') }}</span></div><MarkdownContent :content="result.summary"/></div></header>
      <section class="card scoring-method">
        <div class="scoring-method__heading"><Calculator :size="19"/><div><h2>{{ locale.t('How this formative score is calculated') }}</h2><p>{{ locale.t('Seven evidence-linked domains are scored against behaviour anchors from 0 to 3. Domain weights total 100%.') }}</p></div></div>
        <div class="scoring-method__facts"><span><b>0–3</b>{{ locale.t('Behaviour-anchored domain score') }}</span><span><b>{{ result.totalWeight ?? 100 }}%</b>{{ locale.t('Total domain weight') }}</span><span><b>{{ result.uncappedScore ?? result.aiScore ?? result.score }}</b>{{ locale.t('Weighted score before any safety cap') }}</span></div>
        <code>Σ ({{ locale.t('domain score') }} ÷ 3 × {{ locale.t('domain weight') }}) = {{ result.uncappedScore ?? result.aiScore ?? result.score }} / 100</code>
        <p>{{ locale.t(result.scoringRoundingRule || 'Final total rounded to the nearest whole point before any safety cap') }}.</p>
        <div v-if="result.capApplied != null" class="scoring-cap"><ShieldCheck :size="17"/><span><b>{{ locale.t('Safety score ceiling') }}: {{ result.capApplied }}/100.</b> {{ locale.t(result.scoreCapReason || 'A safety-critical history element was not elicited.') }}</span></div>
        <small>{{ locale.t('This is a product-defined formative score, not a validated high-stakes examination result. Review the linked transcript evidence for each domain.') }}</small>
      </section>
      <div class="feedback-grid"><section class="card card--padded"><div class="feedback-heading"><CheckCircle2/><h2>{{ locale.t('What you did well') }}</h2></div><ul class="feedback-list feedback-list--positive"><li v-for="item in result.strengths" :key="item">{{ item }}</li></ul></section><section class="card card--padded"><div class="feedback-heading"><Target/><h2>{{ locale.t('Focus for next time') }}</h2></div><ul class="feedback-list"><li v-for="item in result.improvements" :key="item">{{ item }}</li></ul></section></div>
      <section v-if="result.missedRedFlags.length" class="card red-flags"><AlertTriangle/><div><h3>{{ locale.t('Safety-critical questions to revisit') }}</h3><article v-for="(flag, index) in result.missedRedFlags" :key="flag"><p>{{ flag }}</p><small v-if="result.missedRedFlagReasons?.[result.missedRedFlagIds?.[index] ?? '']">{{ result.missedRedFlagReasons[result.missedRedFlagIds?.[index] ?? ''] }}</small></article></div></section>
      <div class="section-title"><h2>{{ locale.t('Performance by domain') }}</h2><span class="subtitle">{{ locale.t('Each score is linked to transcript evidence') }}</span></div>
      <section class="domain-list"><article v-for="criterion in result.criteria" :key="criterion.criterionId" class="card domain"><button type="button" :aria-expanded="openDomain === criterion.criterionId" :aria-label="criterion.name" @click="openDomain = openDomain === criterion.criterionId ? null : criterion.criterionId"><span><b>{{ criterion.name }}</b><small class="status-line"><span :class="['evidence-status', `evidence-status--${criterion.evidenceStatus ?? 'not_asked'}`]">{{ evidenceStatusLabel(criterion.evidenceStatus) }}</span><span>{{ locale.t(criterion.level) }}</span><span>{{ criterion.weight }}% {{ locale.t('weight') }} · {{ criterion.weightedScore.toFixed(1) }} {{ locale.t('points') }}</span></small></span><span class="domain__score">{{ criterion.score }} / {{ criterion.maxScore }} <ChevronDown class="domain__chevron" :size="16"/></span></button><div class="progress"><span :style="{ width: `${criterion.score / criterion.maxScore * 100}%` }"></span></div><div v-if="openDomain === criterion.criterionId" class="domain__detail"><MarkdownContent :content="criterion.feedback"/><p v-if="!criterion.evidence.length" class="evidence-empty">{{ evidenceStatusLabel(criterion.evidenceStatus) }}</p><button v-for="evidence in criterion.evidence" :key="evidence.turnId" type="button" class="evidence-quote" @click="focusTurn(evidence.turnId)"><MessageSquareQuote :size="15"/>“{{ evidence.quote }}” <cite>{{ locale.t('Turn') }} {{ evidence.turnId }}</cite></button></div></article></section>
      <section class="card card--padded transcript-card"><div class="section-title"><div><h2>{{ locale.t('Conversation evidence') }}</h2><span class="subtitle">{{ locale.t('Select an evidence quote to locate the original turn below.') }}</span></div></div><div class="transcript-list"><article v-for="turn in result.transcript" :id="`feedback-turn-${turn.id}`" :key="turn.id" :class="['transcript-turn', { 'transcript-turn--highlight': highlightedTurn === turn.id }]" ><div><b>{{ locale.t(turn.role === 'student' ? 'Student' : 'Patient') }}</b><small>{{ locale.t('Turn') }} {{ turn.id }}</small></div><p>{{ turn.content }}</p></article></div></section>
      <footer class="feedback-actions"><RouterLink class="button button--secondary" to="/student/cases"><RefreshCw :size="16"/> {{ locale.t('Practise another case') }}</RouterLink><span><Sparkles :size="15"/> {{ locale.t('Feedback is formative and generated from this consultation transcript.') }}</span></footer>
    </template>
  </div>
</template>

<style scoped>
.feedback-hero{padding:32px 38px;display:grid;grid-template-columns:auto 1fr;align-items:center;gap:35px;margin-top:18px}.feedback-hero h1{font-size:35px}.feedback-hero .markdown-content{max-width:690px}.feedback-level{display:flex;align-items:center;gap:7px;margin-bottom:13px;font-size:11px;color:var(--muted)}.scoring-method{margin-top:17px;padding:20px 24px}.scoring-method__heading{display:flex;gap:10px;align-items:flex-start}.scoring-method__heading>svg{color:var(--green);margin-top:2px}.scoring-method h2{margin:0;font-size:18px}.scoring-method p{margin:4px 0;color:var(--muted);font-size:11px}.scoring-method__facts{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:15px 0}.scoring-method__facts span{display:grid;padding:10px 12px;border-radius:9px;background:#f4f8f6;color:var(--muted);font-size:9px}.scoring-method__facts b{color:var(--ink);font-size:17px}.scoring-method code{display:block;padding:10px 12px;border-radius:8px;background:#26342f;color:#e7f3ed;font-size:11px}.scoring-method>small{display:block;margin-top:10px;color:var(--muted);font-size:9px}.scoring-cap{display:flex;gap:8px;align-items:flex-start;margin-top:10px;padding:10px 12px;border-radius:8px;background:#fff5e4;color:#875c26;font-size:11px}.feedback-grid{display:grid;grid-template-columns:1fr 1fr;gap:17px;margin-top:17px}.feedback-heading{display:flex;gap:9px;align-items:center;color:var(--green)}.feedback-heading h2{margin:0;color:var(--ink);font-size:20px}.feedback-list{padding-left:19px;color:#4d5d57;font-size:13px}.feedback-list li{margin:10px 0}.feedback-list--positive li::marker{color:var(--green)}.red-flags{margin-top:17px;padding:20px;display:flex;gap:13px;color:#855326;background:#fffaf1;border-color:#f1dfbf}.red-flags h3{margin:0}.red-flags article+article{margin-top:10px}.red-flags p{margin:4px 0 0;font-size:12px;font-weight:700}.red-flags small{display:block;margin-top:3px;font-size:11px;line-height:1.5;color:#936d3e}.domain-list{display:grid;gap:10px}.domain{padding:18px 20px}.domain>button{display:flex;justify-content:space-between;align-items:center;width:100%;border:0;background:transparent;text-align:left;cursor:pointer;margin-bottom:10px}.domain>button span:first-child{display:grid}.domain small{color:var(--muted);font-size:10px}.status-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.evidence-status{font-size:9px;padding:2px 7px;border-radius:20px;background:#eef2f0}.evidence-status--covered{color:#2e765b;background:#e7f3ed}.evidence-status--asked_no_credit{color:#996521;background:#fff3df}.evidence-status--not_asked{color:#7b8580;background:#eef1f0}.domain__score{font-weight:700;color:var(--green)}.domain__detail{border-top:1px solid var(--line);padding-top:15px;margin-top:15px}.evidence-empty{font-size:12px;color:var(--muted);margin:10px 0}.evidence-quote{display:block;width:100%;margin:10px 0 0;padding:11px 13px;border:0;border-left:3px solid var(--sage);background:#f6f9f7;text-align:left;font-size:11px;color:#596761;cursor:pointer}.evidence-quote:hover{background:#eaf3ee}.evidence-quote svg{vertical-align:middle;margin-right:6px}.evidence-quote cite{color:#8a9691}.transcript-card{margin-top:18px}.transcript-list{display:grid;gap:8px}.transcript-turn{padding:13px 15px;border:1px solid var(--line);border-radius:9px;background:#fbfcfb;transition:background .2s,box-shadow .2s}.transcript-turn>div{display:flex;justify-content:space-between}.transcript-turn b{font-size:10px;text-transform:uppercase;color:var(--green)}.transcript-turn small{font-size:9px;color:var(--muted)}.transcript-turn p{margin:5px 0 0;font-size:13px;line-height:1.55}.transcript-turn--highlight{background:#fff7dc;box-shadow:0 0 0 2px #e6bd52}.feedback-actions{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-top:25px}.feedback-actions>span{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:10px}@media(max-width:700px){.feedback-hero{grid-template-columns:1fr;padding:25px}.scoring-method__facts{grid-template-columns:1fr}.feedback-grid{grid-template-columns:1fr}.feedback-actions{align-items:stretch;flex-direction:column}.feedback-actions .button{width:100%}}
</style>
