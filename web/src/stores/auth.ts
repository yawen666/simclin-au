import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/services/api'
import type { DemoUser, Role } from '@/types'

const USER_KEY = 'simclin-demo-user'

function storedUser(): DemoUser | null {
  try {
    const value = JSON.parse(localStorage.getItem(USER_KEY) || 'null') as DemoUser | null
    return value && (value.role === 'student' || value.role === 'faculty') ? value : null
  } catch {
    localStorage.removeItem(USER_KEY)
    api.clearToken()
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<DemoUser | null>(storedUser())
  const loading = ref(false)
  const role = computed(() => user.value?.role)
  async function enterAs(nextRole: Role, accessCode?: string) {
    loading.value = true
    try { const result = await api.demoLogin(nextRole, accessCode); user.value = result.user; localStorage.setItem(USER_KEY, JSON.stringify(result.user)); return result.user }
    finally { loading.value = false }
  }
  function logout() { user.value = null; api.clearToken(); localStorage.removeItem(USER_KEY) }
  function resetStudentProfile() { logout(); api.resetVisitor() }
  return { user, loading, role, enterAs, logout, resetStudentProfile }
})
