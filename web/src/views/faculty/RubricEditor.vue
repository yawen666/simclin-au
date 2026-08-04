<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { Archive, Plus, Save, Send, Trash2 } from '@lucide/vue'
import { getActivePinia } from 'pinia'
import { api, apiError, unpack } from '@/services/api'
import type { Rubric, RubricCriterion } from '@/types'
import StatusPill from '@/components/StatusPill.vue'
import { useLocaleStore } from '@/stores/locale'

const locale = getActivePinia() ? useLocaleStore() : { t: (value: string) => value }
const rubrics = ref<Rubric[]>([])
const selectedId = ref('')
const working = ref<Rubric | null>(null)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const savedSnapshot = ref('')

const total = computed(() => working.value?.criteria.reduce((sum, criterion) => sum + Number(criterion.weight), 0) || 0)
const uniqueCriterionIds = computed(() => {
  const ids = working.value?.criteria.map(criterion => criterion.id.trim()) ?? []
  return ids.length === new Set(ids).size
})
const criteriaValid = computed(() => Boolean(
  working.value?.criteria.length
  && working.value.criteria.length <= 20
  && uniqueCriterionIds.value
  && working.value.criteria.every(criterion => (
    criterion.id.trim()
    && criterion.name.trim()
    && Number(criterion.weight) > 0
    && Number(criterion.weight) <= 100
  )),
))
const publishValid = computed(() => Boolean(
  criteriaValid.value
  && working.value?.criteria.every(criterion => (
    criterion.description.trim()
    && criterion.anchors.length === 4
    && new Set(criterion.anchors.map(anchor => Number(anchor.score))).size === 4
    && criterion.anchors.every(anchor => [0, 1, 2, 3].includes(Number(anchor.score)) && anchor.label.trim() && anchor.description.trim())
  )),
))
const dirty = computed(() => Boolean(working.value && JSON.stringify(working.value) !== savedSnapshot.value))
const saveValid = computed(() => Boolean(working.value?.name.trim() && total.value === 100 && criteriaValid.value))
const hasUnpublishedVersion = computed(() => Boolean(
  working.value && (working.value.status === 'draft' || working.value.version !== working.value.publishedVersion),
))

function cloneRubric(value: Rubric): Rubric {
  return JSON.parse(JSON.stringify(value)) as Rubric
}

function canDiscardChanges() {
  return !dirty.value || window.confirm(locale.t('Discard unsaved rubric changes?'))
}

function select(id: string, force = false) {
  if (!force && selectedId.value !== id && !canDiscardChanges()) return
  selectedId.value = id
  const found = rubrics.value.find(rubric => rubric.id === id)
  working.value = found ? cloneRubric(found) : null
  savedSnapshot.value = working.value ? JSON.stringify(working.value) : ''
  error.value = ''
  notice.value = ''
}

async function load(nextId?: string) {
  loading.value = true
  error.value = ''
  try {
    rubrics.value = unpack(await api.getRubrics())
    const current = selectedId.value !== 'new' ? selectedId.value : ''
    const target = nextId || current || rubrics.value[0]?.id
    if (target && rubrics.value.some(rubric => rubric.id === target)) select(target, true)
    else if (rubrics.value[0]) select(rubrics.value[0].id, true)
    else { selectedId.value = ''; working.value = null; savedSnapshot.value = '' }
  } catch (cause) {
    error.value = apiError(cause)
  } finally {
    loading.value = false
  }
}

function blankCriterion(weight = 100): RubricCriterion {
  const suffix = typeof crypto.randomUUID === 'function' ? crypto.randomUUID().slice(0, 8) : `${Date.now()}`
  return {
    id: `criterion-${suffix}`,
    name: 'New assessment domain',
    description: '',
    weight,
    anchors: [
      { score: 0, label: 'Not demonstrated', description: '' },
      { score: 1, label: 'Emerging', description: '' },
      { score: 2, label: 'Developing', description: '' },
      { score: 3, label: 'Proficient', description: '' },
    ],
  }
}

function createNew() {
  if (!canDiscardChanges()) return
  selectedId.value = 'new'
  working.value = {
    id: 'new', name: 'New history-taking rubric', description: '', version: 0, status: 'draft', criteria: [blankCriterion()],
  }
  savedSnapshot.value = JSON.stringify(working.value)
  error.value = ''
  notice.value = ''
}

function updateRedFlagIds(criterion: RubricCriterion, event: Event) {
  criterion.redFlagIds = (event.target as HTMLInputElement).value.split(',').map(value => value.trim()).filter(Boolean)
}

function add() { working.value?.criteria.push(blankCriterion(0)) }
function remove(index: number) { working.value?.criteria.splice(index, 1) }

async function save() {
  if (!working.value || !saveValid.value || !dirty.value) return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const wasNew = working.value.id === 'new'
    const saved = wasNew ? await api.createRubric(working.value) : await api.updateRubric(working.value.id, working.value)
    selectedId.value = String(saved.id)
    await load(String(saved.id))
    notice.value = wasNew ? 'Rubric created.' : 'Rubric saved as a new version.'
  } catch (cause) {
    error.value = apiError(cause)
  } finally {
    saving.value = false
  }
}

async function changeStatus(action: 'publish' | 'archive') {
  if (!working.value || working.value.id === 'new' || dirty.value) return
  if (action === 'publish' && (!publishValid.value || total.value !== 100)) {
    error.value = locale.t('Complete every domain and behaviour anchor before publishing.')
    return
  }
  if (action === 'archive' && !window.confirm(locale.t('Archive this rubric? Published cases must be relinked first.'))) return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    await api.rubricAction(working.value.id, action)
    await load(working.value.id)
    notice.value = action === 'publish' ? 'Rubric published successfully.' : 'Rubric archived successfully.'
  } catch (cause) {
    error.value = apiError(cause)
  } finally {
    saving.value = false
  }
}

function beforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => { window.addEventListener('beforeunload', beforeUnload); void load() })
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
onBeforeRouteLeave(() => canDiscardChanges())
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div><div class="page-eyebrow">{{ locale.t('Assessment design') }}</div><h1>{{ locale.t('Rubric editor') }}</h1><p class="subtitle">{{ locale.t('Define observable, behaviour-anchored history-taking criteria. Weights must total 100%.') }}</p></div>
      <div class="rubric-actions">
        <button type="button" class="button button--secondary" @click="createNew"><Plus :size="16"/>{{ locale.t('New rubric') }}</button>
        <button v-if="working?.id !== 'new' && hasUnpublishedVersion" type="button" class="button button--secondary" :disabled="saving || total !== 100 || !publishValid || dirty" :title="dirty ? locale.t('Save your changes before publishing') : !publishValid ? locale.t('Complete every domain and behaviour anchor before publishing.') : ''" @click="changeStatus('publish')"><Send :size="16"/>{{ locale.t(working?.status === 'published' ? 'Publish changes' : 'Publish') }}</button>
        <button v-if="working?.status === 'published'" type="button" class="button button--secondary" :disabled="saving || dirty" @click="changeStatus('archive')"><Archive :size="16"/>{{ locale.t('Archive') }}</button>
        <button type="button" class="button" :disabled="!working || saving || !saveValid || !dirty" @click="save"><Save :size="16"/>{{ locale.t(working?.id === 'new' ? 'Create rubric' : 'Save new version') }}</button>
      </div>
    </header>
    <div v-if="error" class="alert alert--error" role="alert">{{ error }} <button v-if="!working && !loading" type="button" class="text-button" @click="load()">{{ locale.t('Retry') }}</button></div>
    <div v-if="notice" class="alert alert--success" role="status">{{ locale.t(notice) }}</div>
    <section v-if="working && !publishValid" class="card rubric-check" role="status"><b>{{ locale.t('Publication checks') }}</b><span>{{ locale.t('Every domain needs a description and complete behaviour anchors for scores 0 to 3.') }}</span></section>
    <div v-if="loading" class="loading"><div class="spinner"></div></div>
    <div v-else class="rubric-layout">
      <aside class="card rubric-list" :aria-label="locale.t('Rubrics')">
        <button v-for="rubric in rubrics" :key="rubric.id" type="button" :title="rubric.name" :class="{ active: selectedId === rubric.id }" @click="select(rubric.id)"><b>{{ rubric.name }}</b><small>{{ locale.t('Version') }} {{ rubric.version }} · {{ rubric.criteria.length }} {{ locale.t('domains') }} · {{ locale.t(rubric.status) }}</small><span class="rubric-list__description">{{ rubric.description }}</span></button>
        <button v-if="selectedId === 'new'" type="button" class="active"><b>{{ locale.t('New rubric') }}</b><small>{{ locale.t('Unsaved draft') }}</small></button>
        <div v-if="!rubrics.length && selectedId !== 'new'" class="empty"><p>{{ locale.t('No rubrics available.') }}</p></div>
      </aside>
      <section v-if="working">
        <section class="card card--padded rubric-head">
          <div><div class="field"><label for="rubric-name">{{ locale.t('Rubric name') }}</label><input id="rubric-name" v-model="working.name" class="input" required maxlength="160"></div><div class="field rubric-description"><label for="rubric-description">{{ locale.t('Description') }}</label><textarea id="rubric-description" v-model="working.description" class="textarea" maxlength="1000"></textarea></div></div>
          <div><StatusPill :value="working.status"/><div class="weight-total" :class="{ bad: total !== 100 }"><span>{{ locale.t('Total weight') }}</span><b>{{ total }}%</b><small>{{ locale.t(total === 100 ? 'Ready to save' : 'Must equal 100%') }}</small></div></div>
        </section>
        <section class="criteria">
          <article v-for="(criterion, index) in working.criteria" :key="criterion.id || index" class="card criterion">
            <div class="criterion__head"><span>{{ String(index + 1).padStart(2, '0') }}</span><div class="field"><label :for="`criterion-name-${index}`">{{ locale.t('Assessment domain') }}</label><input :id="`criterion-name-${index}`" v-model="criterion.name" class="input" maxlength="160"></div><div class="field"><label :for="`criterion-weight-${index}`">{{ locale.t('Weight %') }}</label><input :id="`criterion-weight-${index}`" v-model.number="criterion.weight" class="input" type="number" min="0.01" max="100"></div><label class="critical"><input v-model="criterion.critical" type="checkbox">{{ locale.t('Safety critical') }}</label><button type="button" class="button button--link" :aria-label="`${locale.t('Remove')} ${criterion.name}`" @click="remove(index)"><Trash2 :size="16"/></button></div>
            <div class="field"><label :for="`criterion-description-${index}`">{{ locale.t('Description') }}</label><textarea :id="`criterion-description-${index}`" v-model="criterion.description" class="textarea" maxlength="1000"></textarea></div>
            <div class="field red-flags-field"><label :for="`criterion-flags-${index}`">{{ locale.t('Red flag fact IDs') }}</label><input :id="`criterion-flags-${index}`" class="input" :value="criterion.redFlagIds?.join(', ') || ''" :aria-label="`Red flag fact IDs for ${criterion.name}`" placeholder="e.g. chest.hpi.01, chest.assoc.02" @input="updateRedFlagIds(criterion, $event)"><small>{{ locale.t('Comma-separated. IDs must match stable fact or red flag IDs in the linked case.') }}</small></div>
            <details open><summary>{{ locale.t('Behaviour anchors (0–3)') }}</summary><div v-for="anchor in criterion.anchors" :key="anchor.score" class="anchor"><b>{{ anchor.score }}</b><input v-model="anchor.label" class="input" maxlength="120" :aria-label="`${locale.t('Score')} ${anchor.score} ${locale.t('Label')}`"><input v-model="anchor.description" class="input" maxlength="1000" :aria-label="`${locale.t('Score')} ${anchor.score} ${locale.t('Description')}`"></div></details>
          </article>
        </section>
        <button type="button" class="button button--secondary" :disabled="working.criteria.length >= 20" @click="add"><Plus :size="16"/>{{ locale.t('Add assessment domain') }}</button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.rubric-actions{display:flex;gap:8px;flex-wrap:wrap}.rubric-check{display:flex;gap:8px;align-items:center;margin:0 0 16px;padding:12px 15px;background:#fffaf1;border-color:#f1dfbf;color:#765326;font-size:11px}.rubric-layout{display:grid;grid-template-columns:240px 1fr;gap:18px}.rubric-list{padding:8px;height:fit-content}.rubric-list button{border:0;background:transparent;width:100%;text-align:left;padding:13px;border-radius:9px;display:grid;gap:3px;cursor:pointer}.rubric-list button.active{background:var(--green-soft);color:var(--green-dark)}.rubric-list b{font-size:12px}.rubric-list small{font-size:9px;color:var(--muted)}.rubric-head{display:grid;grid-template-columns:1fr auto;gap:20px;align-items:end}.rubric-head>div:last-child{display:grid;gap:10px;justify-items:end}.rubric-description,.red-flags-field{margin-top:11px}.weight-total{min-width:125px;display:grid;padding:9px 14px;border-radius:9px;background:var(--green-soft);color:var(--green)}.weight-total span,.weight-total small{font-size:9px}.weight-total b{font-size:20px}.weight-total.bad{background:var(--amber-soft);color:var(--amber)}.criteria{display:grid;gap:12px;margin:13px 0}.criterion{padding:19px}.criterion__head{display:grid;grid-template-columns:32px 1fr 110px auto auto;gap:10px;align-items:end;margin-bottom:13px}.criterion__head>span{align-self:center;color:var(--sage);font:600 19px 'Source Serif 4',serif}.critical{align-self:center;font-size:10px;white-space:nowrap}.criterion details{margin-top:15px;border-top:1px solid var(--line);padding-top:12px}.criterion summary{cursor:pointer;color:var(--green);font-weight:700;font-size:11px}.anchor{display:grid;grid-template-columns:25px 160px 1fr;gap:8px;align-items:center;margin-top:8px}.anchor b{color:var(--green)}@media(max-width:850px){.rubric-layout{grid-template-columns:1fr}.criterion__head{grid-template-columns:30px 1fr 90px}.critical{grid-column:2}.anchor{grid-template-columns:25px 1fr}.anchor input:last-child{grid-column:2}.rubric-head{grid-template-columns:1fr}.rubric-actions{width:100%}.rubric-actions .button{flex:1}.rubric-check{align-items:flex-start;flex-direction:column}}
</style>
