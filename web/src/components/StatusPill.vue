<script setup lang="ts">
import { useLocaleStore } from '@/stores/locale'
import { getActivePinia } from 'pinia'
defineProps<{ value: string }>()
const locale = getActivePinia() ? useLocaleStore() : { t: (value: string) => value }
</script>
<template><span class="status-pill" :class="`status-pill--${value.toLowerCase().replace(/\s+/g, '-')}`"><span></span>{{ locale.t(value) }}</span></template>
