<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BookOpen, ChartNoAxesColumnIncreasing, ClipboardCheck, FileSliders, History, LayoutDashboard, Library, LogOut, Menu, Settings, UserRoundPlus, X } from '@lucide/vue'
import BrandMark from './BrandMark.vue'
import { useAuthStore } from '@/stores/auth'
import { useLocaleStore } from '@/stores/locale'

const route = useRoute(), router = useRouter(), auth = useAuthStore(), locale = useLocaleStore()
const mobileOpen = ref(false)
const isMobile = ref(false)
const mobileMenuButton = ref<HTMLButtonElement | null>(null)
const mobileNavigation = ref<HTMLElement | null>(null)
const mobileCloseButton = ref<HTMLButtonElement | null>(null)
let mobileQuery: MediaQueryList | undefined
const immersive = computed(() => route.meta.immersive)
const isStudent = computed(() => auth.role === 'student')
const profileInitials = computed(() => (auth.user?.name || 'Demo user').split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase())
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
function resetStudent() {
  if (!window.confirm(locale.t('Start a new anonymous student profile? This browser will no longer be able to open the current profile history.'))) return
  auth.resetStudentProfile()
  void router.push({ path: '/', query: { reason: 'new-student-profile' } })
}
function updateMobile(event: MediaQueryList | MediaQueryListEvent) { isMobile.value = event.matches; if (!event.matches) mobileOpen.value = false }
async function openMobile() { mobileOpen.value = true; await nextTick(); mobileCloseButton.value?.focus() }
function closeMobile(returnFocus = true) { mobileOpen.value = false; if (returnFocus) nextTick(() => mobileMenuButton.value?.focus()) }
function trapFocus(event: KeyboardEvent) {
  if (!isMobile.value || !mobileOpen.value || !mobileNavigation.value) return
  const focusable = [...mobileNavigation.value.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')]
  if (!focusable.length) return
  const first = focusable[0], last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape' && mobileOpen.value) closeMobile() }
onMounted(() => { mobileQuery = window.matchMedia('(max-width: 760px)'); updateMobile(mobileQuery); mobileQuery.addEventListener('change', updateMobile); window.addEventListener('keydown', onKeydown) })
onBeforeUnmount(() => { mobileQuery?.removeEventListener('change', updateMobile); window.removeEventListener('keydown', onKeydown) })
</script>

<template>
  <div v-if="immersive" class="immersive-shell"><RouterView /></div>
  <div v-else class="portal-shell">
    <button ref="mobileMenuButton" class="mobile-menu" :aria-label="locale.t('Open navigation')" aria-controls="portal-navigation" :aria-expanded="mobileOpen" @click="openMobile"><Menu :size="21" /></button>
    <aside id="portal-navigation" ref="mobileNavigation" class="side-nav" :class="{ 'side-nav--open': mobileOpen }" :aria-hidden="isMobile && !mobileOpen" :inert="isMobile && !mobileOpen" @keydown.tab="trapFocus">
      <div class="side-nav__brand"><BrandMark /><span><b>SimClin</b> AU</span><button ref="mobileCloseButton" class="side-nav__close" :aria-label="locale.t('Close navigation')" @click="closeMobile()"><X :size="20" /></button></div>
      <div class="role-label">{{ locale.t(isStudent ? 'Student learning' : 'Faculty workspace') }}</div>
      <nav aria-label="Primary navigation">
        <RouterLink v-for="item in nav" :key="item.to" :to="item.to" :class="{ active: item.exact ? route.path === item.to : route.path.startsWith(item.to) }" @click="closeMobile(false)">
          <component :is="item.icon" :size="19" /><span>{{ item.label }}</span>
        </RouterLink>
      </nav>
      <div class="side-nav__bottom">
        <div class="demo-profile"><span>{{ profileInitials }}</span><div><b>{{ auth.user?.name || 'Demo user' }}</b><small>{{ locale.t(isStudent ? 'Year 3 Medicine' : 'Clinical educator') }}</small></div></div>
        <div class="side-nav__controls">
          <button class="text-button" :aria-label="`${locale.t('Settings')}: ${locale.languageLabel}`" @click="locale.toggle()"><Settings :size="17" />{{ locale.t('Settings') }} · {{ locale.languageLabel }}</button>
          <button v-if="isStudent" class="text-button" @click="resetStudent"><UserRoundPlus :size="17" />{{ locale.t('Start new student profile') }}</button>
          <button class="text-button" @click="leave"><LogOut :size="17" />{{ locale.t('Switch role') }}</button>
        </div>
      </div>
    </aside>
    <button v-if="mobileOpen" class="nav-scrim" :aria-label="locale.t('Close navigation')" @click="closeMobile()"></button>
    <main id="main-content" class="portal-main" tabindex="-1" :inert="isMobile && mobileOpen"><RouterView /></main>
  </div>
</template>
