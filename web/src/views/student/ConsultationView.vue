<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertTriangle, Clock3, CornerDownLeft, DoorOpen, Settings, Stethoscope } from '@lucide/vue'
import { api, apiError } from '@/services/api'
import { streamPatientReply } from '@/services/sse'
import type { ClinicalSession, SessionTurn } from '@/types'
import { useLocaleStore } from '@/stores/locale'

const route = useRoute()
const router = useRouter()
const locale = useLocaleStore()
const session = ref<ClinicalSession | null>(null)
const input = ref('')
const streaming = ref(false)
const ending = ref(false)
const confirmEnding = ref(false)
const error = ref('')
const seconds = ref(0)
const messagesEl = ref<HTMLElement | null>(null)
const composerInput = ref<HTMLTextAreaElement | null>(null)
const finishButton = ref<HTMLButtonElement | null>(null)
const finishDialog = ref<HTMLElement | null>(null)
const cancelEndButton = ref<HTMLButtonElement | null>(null)
const aborter = ref<AbortController | null>(null)
const retryMessageId = ref('')
const retryMessageContent = ref('')
const patientAnnouncement = ref('')
const cancelReason = ref<'user' | 'timeout' | null>(null)
let timer: number | undefined
let unmounted = false
let priorDialogFocus: HTMLElement | null = null

const elapsed = computed(() => `${String(Math.floor(seconds.value / 60)).padStart(2, '0')}:${String(seconds.value % 60).padStart(2, '0')}`)
const hasStudentTurn = computed(() => session.value?.turns.some(turn => turn.role === 'student') ?? false)

function messageTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(locale.locale === 'zh' ? 'zh-CN' : 'en-AU', { hour: '2-digit', minute: '2-digit' })
}

async function scrollBottom() {
  await nextTick()
  messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight, behavior: 'smooth' })
}

async function loadSession() {
  error.value = ''
  try {
    const loaded = await api.getSession(String(route.params.sessionId))
    if (loaded.status !== 'active') {
      if (loaded.status === 'completed' && loaded.result?.id) await router.replace(`/student/feedback/${loaded.result.id}`)
      else await router.replace({ path: '/student/history', query: loaded.status === 'evaluating' ? { evaluation: 'started', session: loaded.id } : {} })
      return
    }
    session.value = loaded
    const startedAt = new Date(loaded.startedAt).getTime()
    seconds.value = Number.isFinite(startedAt) ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0
    if (timer) clearInterval(timer)
    timer = window.setInterval(() => { seconds.value += 1 }, 1000)
    await scrollBottom()
  } catch (cause) {
    error.value = apiError(cause)
  }
}

onMounted(() => void loadSession())

onBeforeUnmount(() => {
  unmounted = true
  if (timer) clearInterval(timer)
  aborter.value?.abort()
})

async function send() {
  const content = input.value.trim()
  if (!content || streaming.value || ending.value || !session.value) return
  input.value = ''
  error.value = ''
  const previousTurns = [...session.value.turns]
  const clientMessageId = retryMessageContent.value === content && retryMessageId.value
    ? retryMessageId.value
    : (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`)
  const now = new Date().toISOString()
  const student: SessionTurn = { id: `local-s-${Date.now()}`, role: 'student', content, createdAt: now }
  const patient: SessionTurn = { id: `local-p-${Date.now()}`, role: 'patient', content: '', createdAt: now }
  session.value.turns.push(student, patient)
  streaming.value = true
  patientAnnouncement.value = ''
  cancelReason.value = null
  aborter.value = new AbortController()
  let idleTimer: number | undefined
  let overallTimer: number | undefined
  const clearDeadlines = () => {
    if (idleTimer) window.clearTimeout(idleTimer)
    if (overallTimer) window.clearTimeout(overallTimer)
  }
  const abortForTimeout = () => {
    cancelReason.value = 'timeout'
    aborter.value?.abort()
  }
  const armIdleDeadline = () => {
    if (idleTimer) window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(abortForTimeout, 45_000)
  }
  armIdleDeadline()
  overallTimer = window.setTimeout(abortForTimeout, 120_000)
  let completed = false
  await scrollBottom()
  try {
    for await (const event of await streamPatientReply(session.value.id, content, aborter.value.signal, clientMessageId)) {
      armIdleDeadline()
      if (event.type === 'meta' && event.studentTurnId) student.id = String(event.studentTurnId)
      if (event.type === 'delta') patient.content += event.delta || ''
      if (event.turnId) patient.id = event.turnId
      if (event.type === 'done') {
        completed = true
        patient.createdAt = new Date().toISOString()
        patientAnnouncement.value = `${locale.t('Patient')}: ${patient.content}`
      }
      if (event.type === 'error') throw new Error(event.message || locale.t('The patient could not respond. Please ask your question again.'))
      await scrollBottom()
    }
    if (!completed) throw new Error(locale.t('The patient response was interrupted. Your consultation has been refreshed; please try again if the answer is not shown.'))
    retryMessageId.value = ''
    retryMessageContent.value = ''
  } catch (cause) {
    if (unmounted) return
    const safeCause = cancelReason.value === 'timeout'
      ? new Error(locale.t('The patient response timed out. Your question has been restored; please try again.'))
      : cancelReason.value === 'user'
        ? new Error(locale.t('The patient response was cancelled. Your question has been restored.'))
        : cause
    try {
      const refreshed = await api.getSession(session.value.id)
      if (refreshed.turns.length >= previousTurns.length + 2) {
        session.value = refreshed
        error.value = ''
        retryMessageId.value = ''
        retryMessageContent.value = ''
      } else {
        session.value.turns = previousTurns
        input.value = input.value || content
        retryMessageId.value = clientMessageId
        retryMessageContent.value = content
        error.value = apiError(safeCause, locale.t('The patient could not respond. Please ask your question again.'))
      }
    } catch {
      session.value.turns = previousTurns
      input.value = input.value || content
      retryMessageId.value = clientMessageId
      retryMessageContent.value = content
      error.value = apiError(safeCause, locale.t('The patient could not respond. Please ask your question again.'))
    }
  } finally {
    clearDeadlines()
    streaming.value = false
    aborter.value = null
    cancelReason.value = null
    await nextTick()
    composerInput.value?.focus()
  }
}

function cancelReply() {
  if (!streaming.value || !aborter.value) return
  cancelReason.value = 'user'
  aborter.value.abort()
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  void send()
}

async function openFinishConfirmation() {
  if (!session.value || !hasStudentTurn.value || streaming.value || ending.value) return
  priorDialogFocus = document.activeElement instanceof HTMLElement ? document.activeElement : finishButton.value
  confirmEnding.value = true
  await nextTick()
  cancelEndButton.value?.focus()
}

function closeFinishConfirmation() {
  confirmEnding.value = false
  nextTick(() => (priorDialogFocus ?? finishButton.value)?.focus())
}

function trapDialogFocus(event: KeyboardEvent) {
  const dialog = finishDialog.value
  if (!dialog) return
  const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled])')]
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

async function finish() {
  if (!session.value || streaming.value || ending.value) return
  confirmEnding.value = false
  ending.value = true
  error.value = ''
  try {
    const result = await api.completeSession(session.value.id)
    if (result.status === 'completed' && result.resultId) await router.push(`/student/feedback/${result.resultId}`)
    else await router.push({ path: '/student/history', query: { evaluation: 'started', session: session.value.id } })
  } catch (cause) {
    error.value = apiError(cause, locale.t('Could not complete the consultation.'))
    await nextTick()
    finishButton.value?.focus()
  } finally {
    ending.value = false
  }
}
</script>

<template>
  <div class="consultation">
    <header class="consultation__header" :inert="confirmEnding">
      <div class="consultation__brand"><span class="case-avatar"><Stethoscope :size="19"/></span><div><h1>{{ session?.caseTitle || locale.t('Clinical consultation') }}</h1><small>{{ locale.t('AI standardised patient · Formative practice') }}</small></div></div>
      <div class="consultation__tools">
        <button class="text-button consultation__language" :aria-label="`${locale.t('Settings')}: ${locale.languageLabel}`" @click="locale.toggle()"><Settings :size="15"/>{{ locale.languageLabel }}</button>
        <span class="consultation__timer"><Clock3 :size="16"/>{{ elapsed }}</span>
        <button ref="finishButton" class="button button--secondary button--sm" :disabled="ending || streaming || !session || !hasStudentTurn" :title="!hasStudentTurn ? locale.t('Ask at least one question before ending the consultation.') : ''" @click="openFinishConfirmation"><DoorOpen :size="16"/>{{ ending ? locale.t('Ending…') : locale.t('End consultation') }}</button>
      </div>
    </header>
    <main id="main-content" ref="messagesEl" class="consultation__messages" tabindex="-1" :inert="confirmEnding">
      <div class="consultation__notice"><AlertTriangle :size="15"/><span><b>{{ locale.t('Do not enter real patient information.') }}</b> {{ locale.t('This is a synthetic formative simulation, not clinical care. The simulated patient will only share information in response to appropriate questions.') }}</span></div>
      <div v-if="!session && !error" class="loading"><div class="spinner"></div></div>
      <section v-else-if="!session && error" class="card consultation__load-error" role="alert">
        <h2>{{ locale.t('The consultation could not be loaded.') }}</h2>
        <p>{{ error }}</p>
        <div><RouterLink class="button button--secondary" to="/student/history">{{ locale.t('Back to practice history') }}</RouterLink><button class="button" @click="loadSession">{{ locale.t('Retry') }}</button></div>
      </section>
      <template v-if="session">
        <div v-for="turn in session.turns" :key="turn.id" class="message" :class="`message--${turn.role}`">
          <span class="message__author">{{ locale.t(turn.role === 'student' ? 'You' : 'Patient') }}<time v-if="messageTime(turn.createdAt)" :datetime="turn.createdAt">{{ messageTime(turn.createdAt) }}</time></span>
          <div class="message__bubble" data-no-translate lang="en-AU"><span v-if="!turn.content && streaming" class="typing" :aria-label="locale.t('The patient is preparing a response.')"><i></i><i></i><i></i></span><template v-else>{{ turn.content }}</template></div>
        </div>
        <div v-if="!session.turns.length" class="consultation__prompt"><span>{{ locale.t('Begin when you are ready.') }}</span><b>{{ locale.t("Introduce yourself and confirm the patient's identity.") }}</b></div>
      </template>
    </main>
    <div class="consultation__composer" :inert="confirmEnding">
      <div v-if="error && session" class="alert alert--error" role="alert">{{ error }}</div>
      <p class="sr-only" aria-live="polite">{{ streaming ? locale.t('The patient is preparing a response.') : '' }}</p>
      <p class="sr-only" data-no-translate aria-live="polite">{{ patientAnnouncement }}</p>
      <form @submit.prevent="send">
        <textarea ref="composerInput" v-model="input" class="textarea" rows="2" maxlength="2000" :placeholder="locale.t('Ask the simulated patient a history-taking question…')" :aria-label="locale.t('Question for the simulated patient')" :disabled="!session" :readonly="streaming || ending" @keydown="handleComposerKeydown"></textarea>
        <button class="send-button" :disabled="!input.trim() || streaming || ending || !session" :aria-label="locale.t('Send question')"><CornerDownLeft :size="19"/></button>
      </form>
      <div class="composer-meta"><button v-if="streaming" type="button" class="text-button cancel-response" @click="cancelReply">{{ locale.t('Cancel response') }}</button><small>{{ locale.t('Do not include real patient data · Press Enter to send · Shift + Enter for a new line') }}</small></div>
    </div>

    <div v-if="confirmEnding" class="dialog-backdrop" @click.self="closeFinishConfirmation" @keydown.esc.prevent.stop="closeFinishConfirmation">
      <section ref="finishDialog" class="confirm-dialog card" role="alertdialog" aria-modal="true" aria-labelledby="end-dialog-title" aria-describedby="end-dialog-description" @keydown.tab="trapDialogFocus">
        <span class="confirm-dialog__icon"><DoorOpen :size="22"/></span>
        <h2 id="end-dialog-title">{{ locale.t('End consultation?') }}</h2>
        <p id="end-dialog-description">{{ locale.t('End this consultation and start generating formative feedback? You cannot add more questions afterwards.') }}</p>
        <div class="confirm-dialog__actions"><button ref="cancelEndButton" class="button button--secondary" @click="closeFinishConfirmation">{{ locale.t('Continue consultation') }}</button><button class="button" @click="finish">{{ locale.t('End and generate feedback') }}</button></div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.consultation{height:100vh;background:#f7faf8;display:grid;grid-template-rows:auto 1fr auto}.consultation__header{background:#fff;border-bottom:1px solid var(--line);padding:13px clamp(17px,4vw,48px);display:flex;align-items:center;justify-content:space-between;gap:20px}.consultation__brand{display:flex;align-items:center;gap:11px;min-width:0}.consultation__brand div{display:grid;min-width:0}.consultation__brand h1{margin:0;font:700 13px Inter,sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.consultation__brand small{font-size:10px;color:var(--muted)}.case-avatar{width:38px;height:38px;flex:0 0 auto;display:grid;place-items:center;color:var(--green);background:var(--green-soft);border-radius:50%}.consultation__tools{display:flex;align-items:center;justify-content:flex-end;gap:17px}.consultation__timer{display:flex;gap:6px;align-items:center;font-variant-numeric:tabular-nums;font-size:13px;color:#55645f}.consultation__messages{overflow-y:auto;padding:28px max(20px,calc((100vw - 780px)/2))}.consultation__notice{display:flex;gap:8px;align-items:flex-start;background:#ecf3f0;color:#5a6b65;padding:10px 14px;border-radius:10px;font-size:11px;margin-bottom:25px}.consultation__load-error{max-width:560px;margin:45px auto;padding:28px;text-align:center}.consultation__load-error p{color:var(--muted)}.consultation__load-error>div{display:flex;justify-content:center;gap:9px}.message{display:flex;flex-direction:column;margin:17px 0;max-width:79%}.message--student{margin-left:auto;align-items:flex-end}.message__author{display:flex;align-items:center;gap:7px;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#687570;margin:0 8px 5px}.message__author time{font-size:9px;letter-spacing:0;font-variant-numeric:tabular-nums}.message__bubble{background:#fff;border:1px solid var(--line);border-radius:4px 16px 16px 16px;padding:13px 16px;color:#374641;line-height:1.65;font-size:14px;white-space:pre-wrap}.message--student .message__bubble{background:var(--green);color:white;border-color:var(--green);border-radius:16px 4px 16px 16px}.consultation__prompt{text-align:center;display:grid;color:#687570;gap:5px;padding:70px 15px}.consultation__prompt b{font:600 21px 'Source Serif 4',serif;color:#40504a}.consultation__composer{background:#fff;border-top:1px solid var(--line);padding:13px max(20px,calc((100vw - 780px)/2)) 18px}.consultation__composer form{position:relative}.consultation__composer textarea{padding-right:55px;min-height:61px}.composer-meta{display:flex;align-items:center;justify-content:flex-end;gap:12px;min-height:18px}.composer-meta small{display:block;text-align:right;color:#687570;font-size:9px}.cancel-response{color:var(--red);font-size:11px}.send-button{position:absolute;right:9px;bottom:9px;width:39px;height:39px;display:grid;place-items:center;border:0;border-radius:9px;background:var(--green);color:white;cursor:pointer}.send-button:disabled{opacity:.4}.typing{display:flex;gap:4px;padding:5px}.typing i{width:6px;height:6px;background:#8ba298;border-radius:50%;animation:bop 1s infinite alternate}.typing i:nth-child(2){animation-delay:.2s}.typing i:nth-child(3){animation-delay:.4s}@keyframes bop{to{transform:translateY(-4px);opacity:.45}}.dialog-backdrop{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:20px;background:rgba(20,42,34,.48)}.confirm-dialog{width:min(460px,100%);padding:28px;text-align:center;box-shadow:0 26px 80px rgba(20,42,34,.24)}.confirm-dialog__icon{width:48px;height:48px;margin:auto;display:grid;place-items:center;border-radius:50%;background:var(--amber-soft);color:var(--amber)}.confirm-dialog h2{margin:14px 0 8px}.confirm-dialog p{margin:0;color:var(--muted);line-height:1.6}.confirm-dialog__actions{display:flex;justify-content:flex-end;gap:9px;margin-top:22px}@media(max-width:620px){.consultation__brand small{display:none}.consultation__timer{display:none}.consultation__messages{padding:20px 14px}.message{max-width:90%}.consultation__header{padding:9px 10px;gap:8px}.consultation__tools{gap:6px;flex:0 0 auto}.consultation__language{padding:6px}.consultation__tools .button{padding:7px 9px}.composer-meta{align-items:flex-end;flex-direction:column-reverse;gap:2px}.confirm-dialog__actions,.consultation__load-error>div{display:grid}.confirm-dialog__actions .button,.consultation__load-error .button{justify-content:center}}
.consultation{height:100dvh}.consultation__composer{padding-bottom:max(18px,env(safe-area-inset-bottom))}
</style>
