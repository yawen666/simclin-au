import { createRouter, createWebHistory } from 'vue-router'
import { nextTick } from 'vue'
import { api } from '@/services/api'
import type { Role } from '@/types'
import LandingView from '@/views/LandingView.vue'
import PortalLayout from '@/components/PortalLayout.vue'

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/', name: 'landing', component: LandingView },
    {
      path: '/student', component: PortalLayout, meta: { role: 'student' }, children: [
        { path: '', name: 'student-home', component: () => import('@/views/student/StudentHome.vue') },
        { path: 'cases', name: 'student-cases', component: () => import('@/views/student/CaseLibrary.vue') },
        { path: 'cases/:id', name: 'student-case', component: () => import('@/views/student/CaseDetail.vue') },
        { path: 'consultation/:sessionId', name: 'consultation', component: () => import('@/views/student/ConsultationView.vue'), meta: { immersive: true } },
        { path: 'feedback/:id', name: 'feedback', component: () => import('@/views/student/FeedbackView.vue') },
        { path: 'history', name: 'student-history', component: () => import('@/views/student/HistoryView.vue') },
      ],
    },
    {
      path: '/faculty', component: PortalLayout, meta: { role: 'faculty' }, children: [
        { path: '', name: 'faculty-home', component: () => import('@/views/faculty/FacultyHome.vue') },
        { path: 'cases', name: 'faculty-cases', component: () => import('@/views/faculty/CaseManagement.vue') },
        { path: 'cases/new', name: 'case-new', component: () => import('@/views/faculty/CaseEditor.vue') },
        { path: 'cases/:id/edit', name: 'case-edit', component: () => import('@/views/faculty/CaseEditor.vue') },
        { path: 'cases/:id/preview', name: 'case-preview', component: () => import('@/views/faculty/CasePreview.vue') },
        { path: 'rubrics', name: 'rubrics', component: () => import('@/views/faculty/RubricEditor.vue') },
        { path: 'results', name: 'results', component: () => import('@/views/faculty/ResultsView.vue') },
        { path: 'results/:id', name: 'result-detail', component: () => import('@/views/faculty/ResultDetail.vue') },
        { path: 'insights', name: 'insights', component: () => import('@/views/faculty/InsightsView.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  const required = to.matched.find((record) => record.meta.role)?.meta.role as Role | undefined
  if (!required) return true
  const raw = localStorage.getItem('simclin-demo-user')
  let user: { role?: Role } | null = null
  try { user = raw ? JSON.parse(raw) as { role?: Role } : null }
  catch {
    localStorage.removeItem('simclin-demo-user')
    api.clearToken()
  }
  if (!api.getToken() || user?.role !== required) return { name: 'landing', query: { next: to.fullPath } }
  return true
})

const routeTitles: Record<string, string> = {
  landing: 'Choose workspace',
  'student-home': 'Student overview',
  'student-cases': 'Case library',
  'student-case': 'Case details',
  consultation: 'Clinical consultation',
  feedback: 'Formative feedback',
  'student-history': 'Practice history',
  'faculty-home': 'Faculty dashboard',
  'faculty-cases': 'Case management',
  'case-new': 'Create case',
  'case-edit': 'Edit case',
  'case-preview': 'Case preview',
  rubrics: 'Rubric editor',
  results: 'Student results',
  'result-detail': 'Attempt review',
  insights: 'Teaching insights',
}

router.afterEach(async (to) => {
  const name = typeof to.name === 'string' ? to.name : ''
  document.title = `${routeTitles[name] || 'Learning workspace'} | SimClin AU`
  await nextTick()
  window.requestAnimationFrame(() => document.getElementById('main-content')?.focus({ preventScroll: true }))
})

declare module 'vue-router' { interface RouteMeta { role?: Role; immersive?: boolean } }
export default router
