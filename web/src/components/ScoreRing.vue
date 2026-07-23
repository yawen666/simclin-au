<script setup lang="ts">
import { computed } from 'vue'
import { getActivePinia } from 'pinia'
import { useLocaleStore } from '@/stores/locale'
const props = withDefaults(defineProps<{ score: number; size?: 'small' | 'large' }>(), { size: 'large' })
const level = computed(() => props.score >= 85 ? 'Excellent' : props.score >= 70 ? 'Competent' : props.score >= 50 ? 'Developing' : 'Needs improvement')
const locale = getActivePinia() ? useLocaleStore() : { t: (value: string) => value }
</script>
<template>
  <div class="score-ring" :class="`score-ring--${size}`" :style="{ '--score': score }" role="img" :aria-label="`${score} ${locale.t('out of 100')}, ${locale.t(level)}`">
    <div><strong>{{ score }}</strong><span>/ 100</span></div>
  </div>
</template>
