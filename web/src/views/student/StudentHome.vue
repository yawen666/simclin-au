<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowRight, BookOpen, CalendarClock, CircleCheck, Stethoscope } from '@lucide/vue'
import { api, apiError, unpack } from '@/services/api'
import { useLocaleStore } from '@/stores/locale'
import { useAuthStore } from '@/stores/auth'
import type { ClinicalCase, ClinicalSession } from '@/types'

const cases = ref<ClinicalCase[]>([])
const sessions = ref<ClinicalSession[]>([])
const loading = ref(true)
const error = ref('')
const locale = useLocaleStore()
const auth = useAuthStore()

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [caseResponse, sessionResponse] = await Promise.all([api.getCases({ status: 'published' }), api.getSessions()])
    cases.value = unpack(caseResponse)
    sessions.value = unpack(sessionResponse)
  } catch (cause) {
    error.value = apiError(cause)
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="page">
    <header class="page-header"><div><div class="page-eyebrow">{{ locale.t('Student workspace') }}</div><h1>{{ locale.t(new Date().getHours() < 12 ? 'Good morning' : 'Good afternoon') }}, {{ auth.user?.name || locale.t('Student') }}.</h1><p class="subtitle">{{ locale.t('Choose a case, meet your patient and practise gathering a clear, safe clinical history.') }}</p></div><RouterLink class="button" to="/student/cases">{{ locale.t('Explore cases') }} <ArrowRight :size="17"/></RouterLink></header>
    <div v-if="loading" class="loading"><div><div class="spinner"></div>{{ locale.t('Loading your learning space…') }}</div></div>
    <section v-else-if="error" class="card empty" role="alert"><h2>{{ locale.t('Your learning space could not be loaded.') }}</h2><p>{{ error }}</p><button class="button" @click="load">{{ locale.t('Retry') }}</button></section>
    <template v-else>
      <section class="stats-grid"><div class="stat-card"><small>{{ locale.t('Available cases') }}</small><strong>{{ cases.length }}</strong><span>{{ locale.t('Across core medicine') }}</span><BookOpen :size="21"/></div><div class="stat-card"><small>{{ locale.t('Completed') }}</small><strong>{{ sessions.filter(session => session.status === 'completed').length }}</strong><span>{{ locale.t('Practice attempts') }}</span><CircleCheck :size="21"/></div><div class="stat-card"><small>{{ locale.t('Latest score') }}</small><strong>{{ sessions.find(session => session.score != null)?.score ?? '—' }}</strong><span>{{ locale.t('Formative, out of 100') }}</span><Stethoscope :size="21"/></div><div class="stat-card"><small>{{ locale.t('Practice time') }}</small><strong>{{ Math.round(sessions.reduce((sum, session) => sum + (session.durationSeconds || 0), 0) / 60) }}{{ locale.t('m') }}</strong><span>{{ locale.t('Total consultation time') }}</span><CalendarClock :size="21"/></div></section>
      <div class="section-title"><h2>{{ locale.t('Recommended next') }}</h2><RouterLink to="/student/cases">{{ locale.t('View all cases') }}</RouterLink></div>
      <div class="grid-3"><RouterLink v-for="item in cases.slice(0, 3)" :key="item.id" class="card case-card" :to="`/student/cases/${item.id}`"><div class="case-card__top"><span class="case-card__icon"><Stethoscope :size="20"/></span><span class="tag">{{ locale.t(item.difficulty) }}</span></div><h3 data-no-translate lang="en-AU">{{ item.title }}</h3><p data-no-translate lang="en-AU">{{ item.subtitle }}</p><div class="case-card__meta"><span>{{ locale.t(item.specialty) }}</span><span>{{ item.durationMinutes }} {{ locale.t('minutes') }}</span></div></RouterLink></div>
      <div v-if="!cases.length" class="card empty"><BookOpen/><h3>{{ locale.t('No cases are published yet') }}</h3><p>{{ locale.t("Your educator's published cases will appear here.") }}</p></div>
    </template>
  </div>
</template>
