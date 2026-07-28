<script setup lang="ts">
import type { SessionTurn } from '@/types'
import { useLocaleStore } from '@/stores/locale'

const props = defineProps<{
  turns: SessionTurn[]
  highlightedTurn?: string | null
  idPrefix: string
  viewer: 'student' | 'faculty'
}>()

const locale = useLocaleStore()

function roleLabel(turn: SessionTurn) {
  if (turn.role === 'patient') return locale.t('Simulated patient')
  return locale.t(props.viewer === 'student' ? 'You (student)' : 'Student')
}

function messageTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(locale.locale === 'zh' ? 'zh-CN' : 'en-AU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
</script>

<template>
  <div class="transcript-list">
    <article
      v-for="turn in turns"
      :id="`${idPrefix}-${turn.id}`"
      :key="turn.id"
      :class="[
        'transcript-turn',
        `transcript-turn--${turn.role}`,
        { 'transcript-turn--highlight': highlightedTurn === turn.id },
      ]"
    >
      <header>
        <span class="role-avatar" aria-hidden="true">{{ turn.role === 'patient' ? 'P' : 'S' }}</span>
        <b>{{ roleLabel(turn) }}</b>
        <time v-if="messageTime(turn.createdAt)" :datetime="turn.createdAt">{{ messageTime(turn.createdAt) }}</time>
      </header>
      <p>{{ turn.content }}</p>
    </article>
  </div>
</template>

<style scoped>
.transcript-list{display:grid;gap:12px}
.transcript-turn{width:min(88%,760px);padding:13px 15px;border:1px solid var(--line);border-radius:12px;transition:background .2s,box-shadow .2s,transform .2s}
.transcript-turn--patient{justify-self:start;background:#f4f8f6;border-left:4px solid var(--green)}
.transcript-turn--student{justify-self:end;background:#eef4f8;border-right:4px solid #557b90}
.transcript-turn header{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px}
.role-avatar{width:23px;height:23px;display:grid;place-items:center;border-radius:50%;font-size:9px;font-weight:800;background:#dcebe5;color:var(--green-dark)}
.transcript-turn--student .role-avatar{background:#dce8ef;color:#315d73}
.transcript-turn b{font-size:10px;text-transform:uppercase;letter-spacing:.045em;color:var(--green-dark)}
.transcript-turn--student b{color:#315d73}
.transcript-turn time{font-size:9px;color:var(--muted);font-variant-numeric:tabular-nums}
.transcript-turn p{margin:7px 0 0 31px;font-size:13px;line-height:1.6;white-space:pre-wrap}
.transcript-turn--highlight{background:#fff7dc;box-shadow:0 0 0 2px #e6bd52;transform:translateY(-1px)}
@media(max-width:700px){.transcript-turn{width:94%}.transcript-turn p{margin-left:0}}
</style>
