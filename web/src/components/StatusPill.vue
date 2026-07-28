<script setup lang="ts">
import { useLocaleStore } from '@/stores/locale'
import { getActivePinia } from 'pinia'
const props = defineProps<{ value: string }>()
const locale = getActivePinia() ? useLocaleStore() : { t: (value: string) => value }
function label() {
  const labels: Record<string, string> = {
    active: 'In progress',
    completed: 'Completed',
    evaluating: 'Evaluating',
    evaluation_failed: 'Evaluation failed',
  }
  return locale.t(labels[props.value] ?? props.value)
}
</script>
<template><span class="status-pill" :class="`status-pill--${value.toLowerCase().replace(/\s+/g, '-')}`"><span></span>{{ label() }}</span></template>
