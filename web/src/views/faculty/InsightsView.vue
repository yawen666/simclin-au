<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { AriaComponent, GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ECharts } from 'echarts/core'
import { AlertCircle, ChartNoAxesColumnIncreasing, CheckCircle2, ClipboardList, Users } from '@lucide/vue'
import { api, apiError } from '@/services/api'
import type { Insights } from '@/types'
import { useLocaleStore } from '@/stores/locale'

echarts.use([BarChart, GridComponent, TooltipComponent, AriaComponent, CanvasRenderer])
const locale = useLocaleStore()
const insights = ref<Insights | null>(null)
const loading = ref(true)
const error = ref('')
const domainEl = ref<HTMLElement | null>(null)
const distributionEl = ref<HTMLElement | null>(null)
let domainChart: ECharts | undefined
let distributionChart: ECharts | undefined

function charts() {
  if (!insights.value || !domainEl.value || !distributionEl.value) return
  domainChart = echarts.init(domainEl.value); distributionChart = echarts.init(distributionEl.value)
  domainChart.setOption({ aria: { enabled: true, decal: { show: true } }, grid: { left: 8, right: 25, top: 12, bottom: 8, containLabel: true }, xAxis: { type: 'value', max: 100, splitLine: { lineStyle: { color: '#edf1ef' } }, axisLabel: { color: '#687570', fontSize: 10 } }, yAxis: { type: 'category', data: insights.value.domainScores.map(i => i.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#4c5d56', fontSize: 10, width: 125, overflow: 'truncate' } }, series: [{ type: 'bar', data: insights.value.domainScores.map(i => i.value), barWidth: 12, itemStyle: { color: '#2c7562', borderRadius: [0, 6, 6, 0] }, label: { show: true, position: 'right', color: '#4c5d56', fontSize: 10 } }], tooltip: { trigger: 'axis' } })
  distributionChart.setOption({ aria: { enabled: true, decal: { show: true } }, grid: { left: 8, right: 12, top: 18, bottom: 5, containLabel: true }, xAxis: { type: 'category', data: insights.value.scoreDistribution.map(i => i.label), axisTick: { show: false }, axisLine: { lineStyle: { color: '#dce5e0' } }, axisLabel: { color: '#687570', fontSize: 10 } }, yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#edf1ef' } }, axisLabel: { color: '#687570', fontSize: 10 } }, series: [{ type: 'bar', data: insights.value.scoreDistribution.map(i => i.value), barMaxWidth: 42, itemStyle: { color: '#8fb7a7', borderRadius: [6, 6, 0, 0] } }], tooltip: { trigger: 'axis' } })
}
function resize() { domainChart?.resize(); distributionChart?.resize() }
function purposeLabel(purpose: string) { return locale.t(purpose === 'disclosure-planner' ? 'Disclosure planner' : purpose === 'patient-actor' ? 'Patient actor' : purpose === 'evaluator' ? 'Evaluator' : purpose) }
async function loadInsights() {
  loading.value = true
  error.value = ''
  try {
    insights.value = await api.getInsights()
  } catch (e) {
    insights.value = null
    error.value = apiError(e)
  } finally {
    loading.value = false
  }
  if (!insights.value) return
  await nextTick()
  domainChart?.dispose()
  distributionChart?.dispose()
  charts()
  window.removeEventListener('resize', resize)
  window.addEventListener('resize', resize)
}
onMounted(() => void loadInsights())
onBeforeUnmount(() => { window.removeEventListener('resize', resize); domainChart?.dispose(); distributionChart?.dispose() })
</script>

<template>
  <div class="page"><header class="page-header"><div><div class="page-eyebrow">{{ locale.t('Learning analytics') }}</div><h1>{{ locale.t('Teaching insights') }}</h1><p class="subtitle">{{ locale.t('Patterns from demonstration attempts. Treat small samples cautiously and review the underlying transcript evidence.') }}</p></div></header>
    <div v-if="loading" class="loading" role="status"><div class="spinner"></div><span class="sr-only">{{ locale.t('Loading') }}</span></div>
    <section v-else-if="error" class="alert alert--error" role="alert"><p>{{ error }}</p><button class="button button--secondary" type="button" @click="loadInsights">{{ locale.t('Try again') }}</button></section>
    <template v-else-if="insights"><section class="stats-grid"><div class="stat-card"><small>{{ locale.t('Total attempts') }}</small><strong>{{ insights.stats.totalAttempts }}</strong><span>{{ locale.t('All case starts') }}</span><Users/></div><div class="stat-card"><small>{{ locale.t('Completion rate') }}</small><strong>{{ insights.stats.completionRate }}%</strong><span>{{ locale.t('Evaluated attempts') }}</span><CheckCircle2/></div><div class="stat-card"><small>{{ locale.t('Median score') }}</small><strong>{{ insights.stats.medianScore }}</strong><span>{{ locale.t('Across completed attempts') }}</span><ChartNoAxesColumnIncreasing/></div><div class="stat-card"><small>{{ locale.t('Published cases') }}</small><strong>{{ insights.stats.publishedCases }}</strong><span>{{ locale.t('Current case versions') }}</span><ClipboardList/></div></section>
      <div class="chart-grid"><section class="card card--padded"><h2>{{ locale.t('Performance by domain') }}</h2><p>{{ locale.t('Mean formative score for each assessment domain.') }}</p><div v-if="insights.domainScores.length" ref="domainEl" class="chart"></div><div v-else class="chart chart--empty"><AlertCircle/><span>{{ locale.t('Complete a consultation to populate domain performance.') }}</span></div><details v-if="insights.domainScores.length" class="chart-data"><summary>{{ locale.t('View chart data') }}</summary><table><thead><tr><th>{{ locale.t('Assessment domain') }}</th><th>{{ locale.t('Mean score') }}</th></tr></thead><tbody><tr v-for="item in insights.domainScores" :key="item.name"><td>{{ item.name }}</td><td>{{ item.value }} / 100</td></tr></tbody></table></details></section><section class="card card--padded"><h2>{{ locale.t('Score distribution') }}</h2><p>{{ locale.t('Completed attempts grouped by formative score band.') }}</p><div v-if="insights.scoreDistribution.some(item => item.value > 0)" ref="distributionEl" class="chart"></div><div v-else class="chart chart--empty"><AlertCircle/><span>{{ locale.t('Completed attempts will appear here by score band.') }}</span></div><details v-if="insights.scoreDistribution.some(item => item.value > 0)" class="chart-data"><summary>{{ locale.t('View chart data') }}</summary><table><thead><tr><th>{{ locale.t('Score band') }}</th><th>{{ locale.t('Attempts') }}</th></tr></thead><tbody><tr v-for="item in insights.scoreDistribution" :key="item.label"><td>{{ item.label }}</td><td>{{ item.value }}</td></tr></tbody></table></details></section></div>
      <section class="card card--padded misses"><div><h2>{{ locale.t('Commonly missed questions') }}</h2><p>{{ locale.t('Use these signals to adjust teaching, cases and rubric guidance.') }}</p></div><div v-for="(item, index) in insights.commonMisses" :key="item.label" class="miss"><span>{{ index + 1 }}</span><b>{{ item.label }}</b><div class="progress"><span :style="{ width: `${Math.min(100, item.count / Math.max(...insights.commonMisses.map(i => i.count), 1) * 100)}%` }"></span></div><strong>{{ item.count }} {{ locale.t('attempts') }}</strong></div><div v-if="!insights.commonMisses.length" class="empty"><AlertCircle/><p>{{ locale.t('Not enough evaluated attempts to identify reliable patterns.') }}</p></div></section>
      <section v-if="insights.aiQuality" class="card card--padded ai-quality"><div class="section-title"><div><h2>{{ locale.t('AI quality and model runs') }}</h2><p>{{ locale.t('Operational signals for prompt and model calibration. These metrics do not measure student performance.') }}</p></div><span class="quality-badge">{{ insights.aiQuality.successRate }}% {{ locale.t('successful') }}</span></div><div class="ai-quality__stats"><div><small>{{ locale.t('Total model calls') }}</small><strong>{{ insights.aiQuality.totalRuns }}</strong></div><div><small>{{ locale.t('Average latency') }}</small><strong>{{ insights.aiQuality.averageLatencyMs }} ms</strong></div><div><small>{{ locale.t('Failed calls') }}</small><strong>{{ insights.aiQuality.failedRuns }}</strong></div><div><small>{{ locale.t('Tokens') }}</small><strong>{{ insights.aiQuality.inputTokens + insights.aiQuality.outputTokens }}</strong></div></div><div class="purpose-list"><div v-for="item in insights.aiQuality.byPurpose" :key="item.purpose" class="purpose-row"><b>{{ purposeLabel(item.purpose) }}</b><span>{{ item.total }} {{ locale.t('calls') }}</span><span>{{ item.averageLatencyMs }} ms</span></div></div><div class="run-table"><div class="run-table__head"><span>{{ locale.t('Recent model runs') }}</span><span>{{ locale.t('Prompt version') }}</span><span>{{ locale.t('Status') }}</span><span>{{ locale.t('Latency') }}</span></div><div v-for="run in insights.aiQuality.recentRuns" :key="`${run.createdAt}-${run.purpose}`" class="run-row"><span>{{ purposeLabel(run.purpose) }} · {{ run.model }}</span><span>{{ run.promptVersion }}</span><span :class="run.status === 'success' ? 'run-ok' : 'run-failed'">{{ run.status === 'success' ? locale.t('Success') : locale.t('Failed') }}</span><span>{{ run.latencyMs }} ms</span></div><p v-if="!insights.aiQuality.recentRuns.length" class="empty-inline">{{ locale.t('No model runs recorded yet.') }}</p></div></section>
    </template>
  </div>
</template>

<style scoped>
.chart-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:18px;margin-top:19px}.chart-grid h2,.misses h2{margin-bottom:4px}.chart-grid p,.misses>div>p{font-size:11px;color:var(--muted)}.chart{height:330px;width:100%}.chart--empty{display:grid;place-content:center;justify-items:center;gap:9px;text-align:center;color:var(--muted);font-size:11px;background:linear-gradient(180deg,transparent,#f8faf9);border-radius:10px}.chart--empty svg{color:var(--sage)}.misses{margin-top:18px}.miss{display:grid;grid-template-columns:28px minmax(160px,1fr) minmax(160px,2fr) 90px;gap:13px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line);font-size:11px}.miss>span{width:25px;height:25px;display:grid;place-items:center;border-radius:50%;background:var(--amber-soft);color:var(--amber);font-weight:700}.miss>strong{text-align:right;color:var(--muted)}.ai-quality{margin-top:18px}.ai-quality .section-title{align-items:flex-start}.ai-quality .section-title p{margin:4px 0 0;color:var(--muted);font-size:11px}.quality-badge{padding:5px 9px;border-radius:20px;background:#e7f3ed;color:#2e765b;font-size:10px;font-weight:700}.ai-quality__stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:15px 0}.ai-quality__stats>div{padding:12px;border-radius:9px;background:#f5f8f6}.ai-quality__stats small{display:block;color:var(--muted);font-size:10px}.ai-quality__stats strong{display:block;margin-top:5px;font-size:19px}.purpose-list{display:grid;gap:7px}.purpose-row{display:grid;grid-template-columns:1fr 100px 80px;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);font-size:11px}.purpose-row span{color:var(--muted)}.run-table{margin-top:18px;border-top:1px solid var(--line);font-size:10px}.run-table__head,.run-row{display:grid;grid-template-columns:1.5fr 1fr 80px 80px;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)}.run-table__head{color:var(--muted);font-weight:700}.run-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.run-ok{color:#2e765b}.run-failed{color:var(--red)}.empty-inline{color:var(--muted);font-size:11px}@media(max-width:850px){.chart-grid{grid-template-columns:1fr}.miss{grid-template-columns:28px 1fr auto}.miss .progress{grid-column:2/4}.ai-quality__stats{grid-template-columns:1fr 1fr}.run-table__head,.run-row{grid-template-columns:1.3fr 1fr 65px 65px}}
.chart-data{margin-top:8px;font-size:11px}.chart-data summary{cursor:pointer;color:var(--green);font-weight:700}.chart-data table{width:100%;margin-top:8px;border-collapse:collapse}.chart-data th,.chart-data td{padding:7px;border-bottom:1px solid var(--line);text-align:left}.chart-data th:last-child,.chart-data td:last-child{text-align:right}
</style>
