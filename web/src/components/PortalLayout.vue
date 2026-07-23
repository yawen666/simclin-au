<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BookOpen, ChartNoAxesColumnIncreasing, ClipboardCheck, FileSliders, History, LayoutDashboard, Library, LogOut, Menu, Settings, X } from '@lucide/vue'
import BrandMark from './BrandMark.vue'
import { useAuthStore } from '@/stores/auth'
import { useLocaleStore } from '@/stores/locale'

const route = useRoute(), router = useRouter(), auth = useAuthStore(), locale = useLocaleStore()
const mobileOpen = ref(false)
const immersive = computed(() => route.meta.immersive)
const isStudent = computed(() => auth.role === 'student')
const nav = computed(() => isStudent.value ? [
  { to: '/student', label: locale.t('Overview'), icon: LayoutDashboard, exact: true },
  { to: '/student/cases', label: locale.t('Case library'), icon: Library },
  { to: '/student/history', label: locale.t('Practice history'), icon: History },
] : [
  { to: '/faculty', label: locale.t('Dashboard'), icon: LayoutDashboard, exact: true },
  { to: '/faculty/cases', label: locale.t('Case management'), icon: BookOpen },
  { to: '/faculty/rubrics', label: locale.t('Rubrics'), icon: FileSliders },
  { to: '/faculty/results', label: locale.t('Results'), icon: ClipboardCheck },
  { to: '/faculty/insights', label: locale.t('Insights'), icon: ChartNoAxesColumnIncreasing },
])
function leave() { auth.logout(); router.push('/') }
</script>

<template>
  <div v-if="immersive" class="immersive-shell"><RouterView /></div>
  <div v-else class="portal-shell">
    <button class="mobile-menu" aria-label="Open navigation" @click="mobileOpen = true"><Menu :size="21" /></button>
    <aside class="side-nav" :class="{ 'side-nav--open': mobileOpen }">
      <div class="side-nav__brand"><BrandMark /><span><b>SimClin</b> AU</span><button class="side-nav__close" aria-label="Close navigation" @click="mobileOpen = false"><X :size="20" /></button></div>
      <div class="role-label">{{ locale.t(isStudent ? 'Student learning' : 'Faculty workspace') }}</div>
      <nav aria-label="Primary navigation">
        <RouterLink v-for="item in nav" :key="item.to" :to="item.to" :class="{ active: item.exact ? route.path === item.to : route.path.startsWith(item.to) }" @click="mobileOpen = false">
          <component :is="item.icon" :size="19" /><span>{{ item.label }}</span>
        </RouterLink>
      </nav>
      <div class="side-nav__bottom">
        <div class="demo-profile"><span>{{ isStudent ? 'AS' : 'EF' }}</span><div><b>{{ auth.user?.name || 'Demo user' }}</b><small>{{ locale.t(isStudent ? 'Year 3 Medicine' : 'Clinical educator') }}</small></div></div>
        <div class="side-nav__controls">
          <button class="text-button" :aria-label="`${locale.t('Settings')}: ${locale.languageLabel}`" @click="locale.toggle()"><Settings :size="17" />{{ locale.t('Settings') }} · {{ locale.languageLabel }}</button>
          <button class="text-button" @click="leave"><LogOut :size="17" />{{ locale.t('Switch role') }}</button>
        </div>
      </div>
    </aside>
    <button v-if="mobileOpen" class="nav-scrim" aria-label="Close navigation" @click="mobileOpen = false"></button>
    <main id="main-content" class="portal-main"><RouterView /></main>
  </div>
</template>
