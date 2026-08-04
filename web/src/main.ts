import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github.css'
import './styles.css'
import App from './App.vue'
import router from './router'
import { AUTH_EXPIRED_EVENT } from './services/api'

window.addEventListener(AUTH_EXPIRED_EVENT, () => {
  if (router.currentRoute.value.name !== 'landing') void router.replace({ name: 'landing', query: { reason: 'session-expired', next: router.currentRoute.value.fullPath } })
})
createApp(App).use(createPinia()).use(router).mount('#app')
