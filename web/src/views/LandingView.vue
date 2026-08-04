<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRight, BookOpenCheck, GraduationCap, LockKeyhole, MessageSquareText, Settings, ShieldCheck, Stethoscope } from '@lucide/vue'
import BrandMark from '@/components/BrandMark.vue'
import { useAuthStore } from '@/stores/auth'
import { useLocaleStore } from '@/stores/locale'
import type { Role } from '@/types'
import { apiError } from '@/services/api'

const router = useRouter(), route = useRoute(), auth = useAuthStore(), locale = useLocaleStore()
const error = ref('')
async function enter(role: Role) {
  error.value = ''
  try {
    await auth.enterAs(role)
    const next = typeof route.query.next === 'string' && route.query.next.startsWith(`/${role}`) ? route.query.next : `/${role}`
    await router.push(next)
  }
  catch (e) { error.value = apiError(e, locale.t('Could not enter this workspace. Please try again.')) }
}
</script>

<template>
  <main id="main-content" class="landing" tabindex="-1">
    <header class="landing__nav"><a class="landing__brand" href="/"><BrandMark /><span><b>SimClin</b> AU</span></a><span class="landing__badge"><span></span>{{ locale.t('Formative learning environment') }}</span><button class="text-button landing__language" :aria-label="`${locale.t('Settings')}: ${locale.languageLabel}`" @click="locale.toggle()"><Settings :size="15" />{{ locale.languageLabel }}</button></header>
    <section class="landing__hero">
      <div class="landing__copy">
        <div class="page-eyebrow">{{ locale.t('AI standardised patient training') }}</div>
        <h1>{{ locale.t('Build clinical confidence,') }}<br><em>{{ locale.t('one conversation at a time.') }}</em></h1>
        <p>{{ locale.t('Practise patient-centred history taking in realistic Australian clinical scenarios, then receive clear, evidence-based formative feedback.') }}</p>
        <div class="landing__principles"><span><ShieldCheck :size="16" />{{ locale.t('Safe, synthetic cases') }}</span><span><MessageSquareText :size="16" />{{ locale.t('Responsive AI patients') }}</span><span><BookOpenCheck :size="16" />{{ locale.t('Educator-led rubrics') }}</span></div>
      </div>
      <form class="role-panel card" :aria-describedby="error ? 'workspace-error' : undefined" @submit.prevent="enter('faculty')">
        <div class="role-panel__head"><span>{{ locale.t('Choose your workspace') }}</span><small>{{ locale.t('No sign-in required for this preview') }}</small></div>
        <div v-if="route.query.reason === 'session-expired'" class="alert alert--warning session-notice" role="status">{{ locale.t('Your session has expired. Please choose a workspace again.') }}</div>
        <button type="button" class="role-choice" :disabled="auth.loading" @click="enter('student')"><span class="role-choice__icon"><GraduationCap /></span><span><b>{{ locale.t('Enter as Student') }}</b><small>{{ locale.t('Practise cases and review your feedback') }}</small></span><ArrowRight class="role-choice__arrow" /></button>
        <button type="submit" class="role-choice" :disabled="auth.loading"><span class="role-choice__icon role-choice__icon--faculty"><Stethoscope /></span><span><b>{{ locale.t('Enter as Faculty') }}</b><small>{{ locale.t('Manage cases, rubrics and results') }}</small></span><ArrowRight class="role-choice__arrow" /></button>
        <div v-if="auth.loading" class="landing__loading"><span class="spinner"></span>{{ locale.t('Preparing your workspace…') }}</div>
        <div v-if="error" id="workspace-error" class="alert alert--error error-box" role="alert">{{ locale.t(error) }}</div>
        <div class="role-panel__foot"><LockKeyhole :size="13" />{{ locale.t('This preview uses built-in demonstration identities.') }}</div>
      </form>
    </section>
    <section class="landing__strip"><div><b>5</b><span>{{ locale.t('curated medical cases') }}</span></div><div><b>7</b><span>{{ locale.t('history-taking domains') }}</span></div><div><b>100%</b><span>{{ locale.t('evidence-linked feedback') }}</span></div></section>
    <footer class="landing__footer"><span>{{ locale.t('Designed for Australian undergraduate medical education') }}</span><span>{{ locale.t('SimClin AU 1.0 Preview · Not for clinical care') }}</span></footer>
  </main>
</template>

<style scoped>
.landing { min-height:100vh; display:flex; flex-direction:column; background:radial-gradient(circle at 78% 15%,rgba(188,214,203,.44),transparent 29%),linear-gradient(135deg,#f7faf8 0%,#eef5f1 100%); overflow:hidden }.landing__nav { height:86px; width:min(1220px,calc(100% - 48px)); margin:auto; display:flex; align-items:center; justify-content:space-between }.landing__brand { display:flex; gap:11px; align-items:center; font-size:20px }.landing__brand b{color:var(--green)}.landing__badge { font-size:11px;color:var(--muted);display:flex;align-items:center;gap:7px}.landing__badge span{width:7px;height:7px;border-radius:50%;background:#4e987f;box-shadow:0 0 0 4px rgba(78,152,127,.13)}
.landing__language { color:var(--green); border:1px solid var(--line); border-radius:999px; padding:7px 11px; background:rgba(255,255,255,.65) }
.landing__hero{width:min(1160px,calc(100% - 48px));margin:auto;display:grid;grid-template-columns:1.1fr .78fr;align-items:center;gap:clamp(50px,8vw,110px);padding:70px 0 85px}.landing__copy h1{font-size:clamp(44px,5.4vw,72px);line-height:1.04;margin:0 0 28px}.landing__copy h1 em{color:var(--green);font-style:normal}.landing__copy>p{font-size:17px;line-height:1.7;max-width:620px;color:#64726d}.landing__principles{display:flex;gap:21px;flex-wrap:wrap;margin-top:28px}.landing__principles span{display:flex;gap:7px;align-items:center;color:#4e625b;font-size:12px}.landing__principles svg{color:var(--green)}
.role-panel{padding:8px;box-shadow:0 28px 80px rgba(34,75,61,.13);background:rgba(255,255,255,.93)}.role-panel__head{padding:21px 20px 16px;display:grid;gap:3px}.role-panel__head span{font:600 20px 'Source Serif 4',serif}.role-panel__head small{color:var(--muted)}.role-choice{width:100%;border:1px solid var(--line);background:#fff;border-radius:13px;padding:18px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;text-align:left;margin-bottom:8px;cursor:pointer;transition:.18s}.role-choice:hover{border-color:#9fc4b5;box-shadow:0 8px 24px rgba(28,82,64,.09);transform:translateY(-1px)}.role-choice__icon{width:47px;height:47px;border-radius:12px;background:var(--green-soft);display:grid;place-items:center;color:var(--green)}.role-choice__icon--faculty{background:#e8eef2;color:#3d657a}.role-choice b,.role-choice small{display:block}.role-choice b{font-size:14px;margin-bottom:3px}.role-choice small{font-size:11px;color:var(--muted)}.role-choice__arrow{color:#9aa8a3;width:18px}.role-panel__foot{display:flex;gap:6px;align-items:center;justify-content:center;padding:13px;color:#89948f;font-size:10px}.landing__loading{display:flex;align-items:center;justify-content:center;gap:8px;color:var(--muted);font-size:11px}.landing__loading .spinner{width:15px;height:15px;margin:0}
.session-notice{margin:0 8px 8px}
.landing__strip{background:rgba(28,79,64,.96);color:white;display:flex;justify-content:center;padding:19px;gap:clamp(40px,9vw,140px)}.landing__strip div{display:flex;gap:10px;align-items:baseline}.landing__strip b{font:600 24px 'Source Serif 4',serif}.landing__strip span{color:#c5d8d1;font-size:11px}.landing__footer{display:flex;justify-content:space-between;width:min(1160px,calc(100% - 48px));margin:auto;padding:16px 0;color:#7d8a85;font-size:10px}
@media(max-width:800px){.landing__hero{grid-template-columns:1fr;padding:45px 0}.landing__copy h1{font-size:43px}.landing__principles{gap:11px}.landing__strip{gap:20px}.landing__strip div{display:grid;text-align:center}.landing__footer{display:grid;gap:5px;text-align:center}.landing__badge{display:none}}
</style>
