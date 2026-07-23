<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowRight, BookOpen, CalendarClock, CircleCheck, Stethoscope } from '@lucide/vue'
import { api, apiError, unpack } from '@/services/api'
import { useLocaleStore } from '@/stores/locale'
import type { ClinicalCase, ClinicalSession } from '@/types'
const cases=ref<ClinicalCase[]>([]), sessions=ref<ClinicalSession[]>([]), loading=ref(true), error=ref(''), locale=useLocaleStore()
onMounted(async()=>{try{const [c,s]=await Promise.all([api.getCases({status:'published'}),api.getSessions()]);cases.value=unpack(c);sessions.value=unpack(s)}catch(e){error.value=apiError(e)}finally{loading.value=false}})
</script>
<template><div class="page">
  <header class="page-header"><div><div class="page-eyebrow">{{ locale.t('Student workspace') }}</div><h1>{{ locale.t(new Date().getHours()<12?'Good morning':'Good afternoon') }}, Alex.</h1><p class="subtitle">{{ locale.t('Choose a case, meet your patient and practise gathering a clear, safe clinical history.') }}</p></div><RouterLink class="button" to="/student/cases">{{ locale.t('Explore cases') }} <ArrowRight :size="17" /></RouterLink></header>
  <div v-if="error" class="alert alert--error">{{error}}</div><div v-if="loading" class="loading"><div><div class="spinner"></div>{{ locale.t('Loading your learning space…') }}</div></div>
  <template v-else>
    <section class="stats-grid"><div class="stat-card"><small>{{ locale.t('Available cases') }}</small><strong>{{cases.length}}</strong><span>{{ locale.t('Across core medicine') }}</span><BookOpen :size="21" /></div><div class="stat-card"><small>{{ locale.t('Completed') }}</small><strong>{{sessions.filter(s=>s.status==='completed').length}}</strong><span>{{ locale.t('Practice attempts') }}</span><CircleCheck :size="21" /></div><div class="stat-card"><small>{{ locale.t('Latest score') }}</small><strong>{{sessions.find(s=>s.score)?.score ?? '—' }}</strong><span>{{ locale.t('Formative, out of 100') }}</span><Stethoscope :size="21" /></div><div class="stat-card"><small>{{ locale.t('Practice time') }}</small><strong>{{Math.round(sessions.reduce((n,s)=>n+(s.durationSeconds||0),0)/60)}}{{ locale.t('m') }}</strong><span>{{ locale.t('Total consultation time') }}</span><CalendarClock :size="21" /></div></section>
    <div class="section-title"><h2>{{ locale.t('Recommended next') }}</h2><RouterLink to="/student/cases">{{ locale.t('View all cases') }}</RouterLink></div>
    <div class="grid-3"><RouterLink v-for="item in cases.slice(0,3)" :key="item.id" class="card case-card" :to="`/student/cases/${item.id}`"><div class="case-card__top"><span class="case-card__icon"><Stethoscope :size="20" /></span><span class="tag">{{item.difficulty}}</span></div><h3>{{item.title}}</h3><p>{{item.subtitle}}</p><div class="case-card__meta"><span>{{item.specialty}}</span><span>{{item.durationMinutes}} minutes</span></div></RouterLink></div>
    <div v-if="!cases.length" class="card empty"><BookOpen /><h3>{{ locale.t('No cases are published yet') }}</h3><p>{{ locale.t("Your educator's published cases will appear here.") }}</p></div>
  </template>
</div></template>
