import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/services/api'
import type { DemoUser, Role } from '@/types'

const USER_KEY = 'simclin-demo-user'
export const useAuthStore = defineStore('auth', () => {
  const user = ref<DemoUser | null>(JSON.parse(localStorage.getItem(USER_KEY) || 'null'))
  const loading = ref(false)
  const role = computed(() => user.value?.role)
  async function enterAs(nextRole: Role) {
    loading.value = true
    try { const result = await api.demoLogin(nextRole); user.value = result.user; localStorage.setItem(USER_KEY, JSON.stringify(result.user)); return result.user }
    finally { loading.value = false }
  }
  function logout() { user.value = null; api.clearToken(); localStorage.removeItem(USER_KEY) }
  return { user, loading, role, enterAs, logout }
})
