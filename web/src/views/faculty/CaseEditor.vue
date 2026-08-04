<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Eye, Plus, Save, Send, Trash2 } from '@lucide/vue'
import { api, apiError, unpack } from '@/services/api'
import type { AtomicFact, CaseRedFlag, ClinicalCase, Rubric } from '@/types'
import { useLocaleStore } from '@/stores/locale'

const route = useRoute()
const router = useRouter()
const locale = useLocaleStore()
const createdId = ref<string | null>(null)
const id = computed(() => createdId.value ?? (route.params.id ? String(route.params.id) : null))
const loading = ref(Boolean(id.value))
const saving = ref(false)
const error = ref('')
const fatalLoadError = ref('')
const notice = ref('')
const submitIntent = ref<'draft' | 'publish'>('draft')
const savedSnapshot = ref('')
const rubrics = ref<Rubric[]>([])
const unknownRule = ref('If the student asks for information not provided, say you do not know or cannot remember.')
const unknownPhrases = ref(['I am not sure.', 'I cannot remember that.'])

const specialtyOptions = ['General Medicine', 'Cardiology / Emergency Medicine', 'Respiratory Medicine / General Medicine', 'Gastroenterology / General Medicine', 'Neurology / Emergency Medicine', 'Endocrinology / General Medicine']
const settingOptions = ['General practice', 'University health general practice clinic', 'Same-day acute general practice clinic', 'Emergency department assessment area', 'Emergency department cubicle', 'Monitored emergency department cubicle']
const categories = ['presenting_complaint', 'associated_symptoms', 'red_flag', 'past_history', 'medication', 'allergy', 'family_history', 'social_history', 'patient_perspective']
const disclosureLevels = ['opening', 'broad_question', 'direct_question', 'specific_question']

const form = ref<Partial<ClinicalCase>>({
  title: '', subtitle: '', specialty: 'General Medicine', setting: 'General practice', difficulty: 'Year 3', durationMinutes: 10,
  status: 'draft', task: 'Take a focused, patient-centred history. Identify relevant safety concerns.', learningObjectives: [],
  patientName: '', patientAge: 45, presentingComplaint: '', openingStatement: '',
  atomicFacts: [{ id: '', category: 'presenting_complaint', label: 'Main symptom', value: '', disclosureLevel: 'opening', triggers: [] }],
  redFlags: [], patientActorRules: ['Stay in character as the patient.', 'Do not volunteer facts until asked.'], caseData: {},
})

const facts = computed(() => form.value.atomicFacts ?? [])
const redFlags = computed(() => form.value.redFlags ?? [])
const structuredIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/
function validText(value: unknown, min: number, max: number) {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max
}
const validationIssues = computed(() => {
  const issues: string[] = []
  if (!form.value.rubricId || !rubrics.value.some(r => r.id === String(form.value.rubricId) && r.status === 'published')) issues.push('A published rubric is required.')
  if (!form.value.title?.trim()) issues.push('Add a case title.')
  else if (!validText(form.value.title, 2, 160)) issues.push('The case title must contain 2 to 160 characters.')
  if (!validText(form.value.subtitle, 1, 1000)) issues.push('Add a student-facing subtitle of up to 1,000 characters.')
  if (!validText(form.value.setting, 1, 120)) issues.push('Add a clinical setting of up to 120 characters.')
  if (!validText(form.value.task, 1, 4000)) issues.push('Add the student task of up to 4,000 characters.')
  if (!validText(form.value.presentingComplaint, 1, 4000)) issues.push('Add the presenting complaint of up to 4,000 characters.')
  if (!validText(form.value.patientName, 1, 120) || !Number.isInteger(Number(form.value.patientAge)) || Number(form.value.patientAge) < 1 || Number(form.value.patientAge) > 110) issues.push('Complete the patient identity.')
  if (!Number.isInteger(Number(form.value.durationMinutes)) || Number(form.value.durationMinutes) < 3 || Number(form.value.durationMinutes) > 60) issues.push('Set the consultation duration between 3 and 60 minutes.')
  if (!validText(form.value.openingStatement, 1, 2000)) issues.push('Add an opening statement of up to 2,000 characters.')
  if (!facts.value.length || facts.value.length > 80 || facts.value.some(f => !validText(f.label, 1, 200) || !validText(f.value, 1, 2000) || !validText(f.category, 1, 80) || !disclosureLevels.includes(f.disclosureLevel))) issues.push('Include 1 to 80 complete patient facts within the field limits.')
  if (facts.value.some(f => f.id.trim() && !structuredIdPattern.test(f.id.trim()))) issues.push('Fact IDs may contain only letters, numbers, dots, underscores, colons and hyphens.')
  if (facts.value.some(f => (f.triggers ?? []).length > 25 || (f.triggers ?? []).some(trigger => !validText(trigger, 1, 200)))) issues.push('Each fact may have up to 25 trigger phrases of up to 200 characters.')
  const factIds = facts.value.map(f => f.id.trim()).filter(Boolean)
  if (new Set(factIds).size !== factIds.length) issues.push('Fact IDs must be unique.')
  if (redFlags.value.length > 40) issues.push('A case may contain up to 40 red flags.')
  const redFlagIds = redFlags.value.map(flag => flag.id.trim()).filter(Boolean)
  if (new Set(redFlagIds).size !== redFlagIds.length) issues.push('Red flag IDs must be unique.')
  redFlags.value.forEach(flag => {
    if (!structuredIdPattern.test(flag.id.trim()) || !validText(flag.label, 1, 200)) issues.push('Complete every red flag with a structurally valid ID and label.')
    if (!flag.linkedFactIds.length || flag.linkedFactIds.length > 20) issues.push('Every red flag must link to between 1 and 20 patient facts.')
    if (flag.linkedFactIds.some(factId => !factIds.includes(factId.trim()))) issues.push('Every linked red flag fact must exist in this case.')
    if ((flag.requiredQuestions ?? []).length > 25 || (flag.requiredQuestions ?? []).some(question => !validText(question, 1, 200))) issues.push('Each red flag may have up to 25 required question themes of up to 200 characters.')
  })
  const learningObjectives = form.value.learningObjectives ?? []
  if (learningObjectives.length > 20 || learningObjectives.some(value => !validText(value, 1, 500))) issues.push('Learning objectives must be complete, with no more than 20 entries of up to 500 characters.')
  const actorRules = form.value.patientActorRules ?? []
  if (actorRules.length > 20 || actorRules.some(value => !validText(value, 1, 500))) issues.push('Patient actor rules must be complete, with no more than 20 entries of up to 500 characters.')
  return [...new Set(issues)]
})
const canPublish = computed(() => validationIssues.value.length === 0)
const currentSnapshot = computed(() => JSON.stringify({ form: form.value, unknownRule: unknownRule.value, unknownPhrases: unknownPhrases.value }))
const dirty = computed(() => !loading.value && !fatalLoadError.value && currentSnapshot.value !== savedSnapshot.value)

function markSaved() { savedSnapshot.value = currentSnapshot.value }

function hydrate(value: ClinicalCase) {
  form.value = {
    ...value,
    atomicFacts: value.atomicFacts ?? [],
    redFlags: value.redFlags ?? [],
    patientActorRules: value.patientActorRules ?? [],
  }
  const policy = value.unknownPolicy ?? {}
  unknownRule.value = typeof policy.rule === 'string' ? policy.rule : unknownRule.value
  unknownPhrases.value = Array.isArray(policy.defaultPhrases) ? policy.defaultPhrases.filter((item): item is string => typeof item === 'string') : unknownPhrases.value
}

async function loadEditor() {
  loading.value = true
  fatalLoadError.value = ''
  try {
    rubrics.value = unpack(await api.getRubrics())
    if (id.value) hydrate(await api.getCase(id.value))
    markSaved()
  } catch (e) { fatalLoadError.value = apiError(e) } finally { loading.value = false }
}

function beforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => { window.addEventListener('beforeunload', beforeUnload); void loadEditor() })
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
onBeforeRouteLeave(() => !dirty.value || window.confirm(locale.t('Discard unsaved case changes?')))

function objective(action: 'add' | 'remove', index = 0) {
  form.value.learningObjectives = action === 'add'
    ? [...(form.value.learningObjectives ?? []), '']
    : (form.value.learningObjectives ?? []).filter((_, i) => i !== index)
}
function fact(action: 'add' | 'remove', index = 0) {
  form.value.atomicFacts = action === 'add'
    ? [...facts.value, { id: `fact-${Date.now()}`, category: 'presenting_complaint', label: '', value: '', disclosureLevel: 'direct_question', triggers: [] }]
    : facts.value.filter((_, i) => i !== index)
}
function redFlag(action: 'add' | 'remove', index = 0) {
  form.value.redFlags = action === 'add'
    ? [...redFlags.value, { id: `red-flag-${Date.now()}`, label: '', linkedFactIds: [], critical: false, requiredQuestions: [] }]
    : redFlags.value.filter((_, i) => i !== index)
}
function actorRule(action: 'add' | 'remove', index = 0) {
  form.value.patientActorRules = action === 'add'
    ? [...(form.value.patientActorRules ?? []), '']
    : (form.value.patientActorRules ?? []).filter((_, i) => i !== index)
}
function listValue(value: string[] | undefined) { return (value ?? []).join(', ') }
function parseList(value: string) { return value.split(',').map(item => item.trim()).filter(Boolean) }
function eventValue(event: Event) { return (event.target as HTMLInputElement).value }
function setFactTriggers(entry: AtomicFact, value: string) { entry.triggers = parseList(value) }
function setRequiredQuestions(entry: CaseRedFlag, value: string) { entry.requiredQuestions = parseList(value) }
function toggleFactLink(flag: CaseRedFlag, factId: string) {
  const canonicalId = factId.trim()
  const linkedIds = [...new Set(flag.linkedFactIds.map(value => value.trim()).filter(Boolean))]
  flag.linkedFactIds = linkedIds.includes(canonicalId) ? linkedIds.filter(value => value !== canonicalId) : [...linkedIds, canonicalId]
}

async function save(publish = false) {
  if (fatalLoadError.value || loading.value) return
  if (publish && !canPublish.value) { error.value = 'Complete the case quality checks before publishing.'; return }
  saving.value = true; error.value = ''; notice.value = ''
  try {
    if (publish && id.value && !dirty.value) {
      hydrate(await api.caseAction(id.value, 'publish'))
      markSaved()
      notice.value = 'Case published as a new immutable version.'
      return
    }
    const payload = {
      ...form.value,
      learningObjectives: form.value.learningObjectives ?? [],
      patientActorRules: form.value.patientActorRules ?? [],
      unknownPolicy: { rule: unknownRule.value, defaultPhrases: unknownPhrases.value },
    }
    const existingId = id.value
    const result = existingId ? await api.updateCase(existingId, payload) : await api.createCase(payload)
    const resultId = String(result.id)
    hydrate(result)
    markSaved()
    if (!existingId) {
      createdId.value = resultId
      await router.replace(`/faculty/cases/${resultId}/edit`)
      if (String(route.params.id ?? '') === resultId) createdId.value = null
    }
    if (publish) {
      notice.value = 'Draft saved.'
      hydrate(await api.caseAction(resultId, 'publish'))
      markSaved()
      notice.value = 'Case published as a new immutable version.'
    } else notice.value = 'Draft saved.'
  } catch (e) { error.value = apiError(e, 'Could not save this case.') } finally { saving.value = false }
}

function submitEditor() {
  const publish = submitIntent.value === 'publish'
  submitIntent.value = 'draft'
  void save(publish)
}
</script>

<template>
  <div class="page">
    <RouterLink class="text-button" to="/faculty/cases"><ArrowLeft :size="16"/> {{ locale.t('Case management') }}</RouterLink>
    <header class="page-header editor-head">
      <div><div class="page-eyebrow">{{ id ? locale.t('Edit structured case') : locale.t('New structured case') }}</div><h1>{{ id ? (form.title || locale.t('Edit case')) : locale.t('Create a case') }}</h1><p class="subtitle">{{ locale.t('Only information contained in the structured case can be disclosed by the AI patient.') }}</p></div>
      <div class="editor-actions"><RouterLink v-if="id && !fatalLoadError" class="button button--secondary" :to="`/faculty/cases/${id}/preview`"><Eye :size="16"/> {{ locale.t('Preview') }}</RouterLink><button class="button button--secondary" type="submit" form="case-editor-form" formnovalidate :disabled="saving || loading || Boolean(fatalLoadError) || !dirty" @click="submitIntent = 'draft'"><Save :size="16"/> {{ locale.t('Save draft') }}</button><button class="button" type="submit" form="case-editor-form" :disabled="saving || loading || Boolean(fatalLoadError) || !canPublish" @click="submitIntent = 'publish'"><Send :size="16"/> {{ locale.t('Publish') }}</button></div>
    </header>
    <div v-if="error" class="alert alert--error" role="alert">{{ error }}</div><div v-if="notice" class="alert alert--success" role="status">{{ notice }}</div>
    <section v-if="!loading && !fatalLoadError && validationIssues.length" class="card quality-checks"><strong>{{ locale.t('Publication checks') }}</strong><ul><li v-for="issue in validationIssues" :key="issue">{{ locale.t(issue) }}</li></ul></section>
    <div v-if="loading" class="loading"><div class="spinner"></div></div>
    <section v-else-if="fatalLoadError" class="card empty" role="alert"><h2>{{ locale.t('The case editor could not be loaded.') }}</h2><p>{{ fatalLoadError }}</p><div class="empty-actions"><RouterLink class="button button--secondary" to="/faculty/cases">{{ locale.t('Back to case management') }}</RouterLink><button class="button" @click="loadEditor">{{ locale.t('Retry') }}</button></div></section>
    <form v-else id="case-editor-form" class="editor-layout" @submit.prevent="submitEditor">
      <div class="editor-main">
        <section class="card card--padded"><h2>{{ locale.t('Case overview') }}</h2><div class="form-grid">
          <div class="field field--wide"><label for="case-title">{{ locale.t('Case title') }}</label><input id="case-title" v-model="form.title" class="input" required maxlength="160" placeholder="e.g. Pressure in my chest"></div>
          <div class="field field--wide"><label for="case-subtitle">{{ locale.t('Student-facing subtitle') }}</label><input id="case-subtitle" v-model="form.subtitle" class="input" required maxlength="1000" placeholder="A concise, non-revealing introduction"></div>
          <div class="field"><label for="case-specialty">{{ locale.t('Specialty') }}</label><select id="case-specialty" v-model="form.specialty" class="select" required><option v-for="option in specialtyOptions" :key="option" :value="option">{{ locale.t(option) }}</option></select></div>
          <div class="field"><label for="case-setting">{{ locale.t('Clinical setting') }}</label><select id="case-setting" v-model="form.setting" class="select" required><option v-for="option in settingOptions" :key="option" :value="option">{{ locale.t(option) }}</option></select></div>
          <div class="field"><label for="case-difficulty">{{ locale.t('Difficulty') }}</label><select id="case-difficulty" v-model="form.difficulty" class="select"><option value="Year 2">{{ locale.t('Year 2') }}</option><option value="Year 3">{{ locale.t('Year 3') }}</option><option value="Year 4">{{ locale.t('Year 4') }}</option></select></div>
          <div class="field"><label for="case-duration">{{ locale.t('Time allowed (minutes)') }}</label><input id="case-duration" v-model.number="form.durationMinutes" class="input" type="number" min="3" max="60" required></div>
          <div class="field field--wide"><label for="case-task">{{ locale.t('Student task') }}</label><textarea id="case-task" v-model="form.task" class="textarea" required maxlength="4000"></textarea></div>
        </div></section>

        <section class="card card--padded"><h2>{{ locale.t('Patient identity and presentation') }}</h2><div class="form-grid">
          <div class="field"><label for="patient-name">{{ locale.t('Patient name') }}</label><input id="patient-name" v-model="form.patientName" class="input" required maxlength="120"></div><div class="field"><label for="patient-age">{{ locale.t('Age') }}</label><input id="patient-age" v-model.number="form.patientAge" class="input" type="number" min="1" max="110" required></div>
          <div class="field field--wide"><label for="presenting-complaint">{{ locale.t('Presenting complaint') }}</label><textarea id="presenting-complaint" v-model="form.presentingComplaint" class="textarea" required maxlength="4000" placeholder="Clinical source of truth. Include onset, symptoms and patient language."></textarea></div>
          <div class="field field--wide"><label for="opening-statement">{{ locale.t('Opening statement') }}</label><textarea id="opening-statement" v-model="form.openingStatement" class="textarea" required maxlength="2000" placeholder="The first sentence the patient says when the consultation starts."></textarea></div>
        </div></section>

        <section class="card card--padded"><div class="section-title"><div><h2>{{ locale.t('Structured patient facts') }}</h2><p class="editor-help">{{ locale.t('The AI may only disclose these facts in response to an appropriate question.') }}</p></div><button class="button button--secondary button--sm" type="button" @click="fact('add')"><Plus :size="15"/> {{ locale.t('Add fact') }}</button></div>
          <article v-for="(entry, index) in facts" :key="entry.id || index" class="fact-card"><div class="fact-card__head"><b>{{ locale.t('Fact') }} {{ index + 1 }}</b><button class="button button--link" type="button" :title="locale.t('Remove')" @click="fact('remove', index)"><Trash2 :size="16"/></button></div><div class="form-grid">
            <div class="field"><label>{{ locale.t('Label') }}</label><input v-model="entry.label" class="input" required placeholder="e.g. Symptom onset"></div><div class="field"><label>{{ locale.t('Category') }}</label><select v-model="entry.category" class="select"><option v-for="category in categories" :key="category" :value="category">{{ locale.t(category) }}</option></select></div>
            <div class="field field--wide"><label>{{ locale.t('Patient fact') }}</label><textarea v-model="entry.value" class="textarea" required></textarea></div><div class="field"><label>{{ locale.t('Disclosure level') }}</label><select v-model="entry.disclosureLevel" class="select"><option v-for="level in disclosureLevels" :key="level" :value="level">{{ locale.t(level) }}</option></select></div>
            <div class="field"><label>{{ locale.t('Stable fact ID') }}</label><input v-model="entry.id" class="input" placeholder="Generated automatically"><small>{{ locale.t('Keep unchanged once this case has been used.') }}</small></div><div class="field field--wide"><label>{{ locale.t('Question trigger phrases') }}</label><input class="input" :value="listValue(entry.triggers)" @input="setFactTriggers(entry, eventValue($event))" placeholder="when did it start, onset, what happened"><small>{{ locale.t('Comma-separated phrases that help the safety check recognise explicit screening.') }}</small></div>
          </div></article>
        </section>

        <section class="card card--padded"><div class="section-title"><div><h2>{{ locale.t('Safety red flags') }}</h2><p class="editor-help">{{ locale.t('Link each safety concern to the facts that demonstrate it.') }}</p></div><button class="button button--secondary button--sm" type="button" @click="redFlag('add')"><Plus :size="15"/> {{ locale.t('Add red flag') }}</button></div>
          <article v-for="(flag, index) in redFlags" :key="flag.id || index" class="fact-card red-flag-card"><div class="fact-card__head"><b>{{ locale.t('Red flag') }} {{ index + 1 }}</b><button class="button button--link" type="button" :title="locale.t('Remove')" @click="redFlag('remove', index)"><Trash2 :size="16"/></button></div><div class="form-grid">
            <div class="field"><label>{{ locale.t('Red flag ID') }}</label><input v-model="flag.id" class="input" required placeholder="e.g. chest.rf.ongoing"></div><div class="field"><label>{{ locale.t('Label') }}</label><input v-model="flag.label" class="input" required placeholder="Ongoing concerning symptoms"></div><label class="check-field"><input v-model="flag.critical" type="checkbox"> <span>{{ locale.t('Safety critical') }}</span></label>
            <div class="field field--wide"><label>{{ locale.t('Linked facts') }}</label><div class="fact-links"><label v-for="factItem in facts.filter(item => item.id.trim())" :key="factItem.id.trim()" class="check-field"><input type="checkbox" :checked="flag.linkedFactIds.some(value => value.trim() === factItem.id.trim())" @change="toggleFactLink(flag, factItem.id)"><span>{{ factItem.label || factItem.id.trim() }}</span></label><small v-if="!facts.some(item => item.id.trim())">{{ locale.t('Add stable fact IDs before linking red flags.') }}</small></div></div>
            <div class="field field--wide"><label>{{ locale.t('Required question themes') }}</label><input class="input" :value="listValue(flag.requiredQuestions)" @input="setRequiredQuestions(flag, eventValue($event))" placeholder="onset, duration, escalation"><small>{{ locale.t('Comma-separated themes used for teacher review and future scoring rules.') }}</small></div>
          </div></article><p v-if="!redFlags.length" class="empty-inline">{{ locale.t('No red flags defined yet.') }}</p>
        </section>

        <section class="card card--padded"><h2>{{ locale.t('Patient behaviour rules') }}</h2><p class="editor-help">{{ locale.t('These rules guide the AI patient when a student asks for unknown information or tries to change the role.') }}</p><div class="field"><label>{{ locale.t('Unknown information policy') }}</label><textarea v-model="unknownRule" class="textarea" rows="2"></textarea></div><div class="field"><label>{{ locale.t('Default unknown phrases') }}</label><input class="input" :value="listValue(unknownPhrases)" @input="unknownPhrases=parseList(eventValue($event))" placeholder="I am not sure, I cannot remember"></div><div class="repeat-heading"><b>{{ locale.t('Actor rules') }}</b><button class="button button--secondary button--sm" type="button" @click="actorRule('add')"><Plus :size="15"/> {{ locale.t('Add rule') }}</button></div><div v-for="(_, index) in form.patientActorRules" :key="index" class="repeat-row"><input v-model="form.patientActorRules![index]" class="input" :aria-label="`${locale.t('Actor rule')} ${index + 1}`"><button class="button button--link" type="button" :title="locale.t('Remove')" @click="actorRule('remove', index)"><Trash2 :size="16"/></button></div></section>

        <section class="card card--padded"><h2>{{ locale.t('Learning objectives') }}</h2><div v-for="(_, index) in form.learningObjectives" :key="index" class="repeat-row"><input v-model="form.learningObjectives![index]" class="input" :aria-label="`${locale.t('Learning objective')} ${index + 1}`"><button class="button button--link" type="button" :title="locale.t('Remove')" @click="objective('remove', index)"><Trash2 :size="16"/></button></div><button class="button button--secondary button--sm" type="button" @click="objective('add')"><Plus :size="15"/> {{ locale.t('Add objective') }}</button></section>
      </div>
      <aside class="editor-side"><section class="card card--padded"><h3>{{ locale.t('Assessment rubric') }}</h3><div class="field"><label for="linked-rubric">{{ locale.t('Linked rubric') }} <span aria-hidden="true">*</span></label><select id="linked-rubric" v-model="form.rubricId" class="select" required><option value="">{{ locale.t('Select a rubric') }}</option><option v-for="r in rubrics.filter(item => item.status === 'published')" :key="r.id" :value="r.id">{{ r.name }} · v{{ r.version }}</option></select><small>{{ locale.t('A published rubric is required before this case can be published.') }}</small></div></section><section class="card card--padded educator-note"><h3>{{ locale.t('Educator note') }}</h3><p>{{ locale.t('Preview the patient before publishing. Check that the AI answers consistently, does not volunteer hidden facts and responds safely to escalation.') }}</p></section></aside>
    </form>
  </div>
</template>

<style scoped>
.editor-head{align-items:center}.editor-actions{display:flex;gap:8px}.editor-layout{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:18px}.editor-main{display:grid;gap:18px}.editor-side{display:grid;gap:18px;align-content:start;position:sticky;top:20px;height:fit-content}.repeat-row{display:grid;grid-template-columns:1fr auto;gap:7px;margin:8px 0}.repeat-heading{display:flex;justify-content:space-between;align-items:center;margin:18px 0 8px}.educator-note{background:#eff6f3}.educator-note p,.editor-help{font-size:12px;color:var(--muted);margin:0}.quality-checks{margin:18px 0;padding:15px 18px;background:#fffaf1;border-color:#f1dfbf;color:#765326}.quality-checks ul{margin:8px 0 0;padding-left:18px;font-size:12px}.fact-card{border:1px solid var(--line);border-radius:12px;padding:16px;margin:10px 0;background:#fbfcfb}.fact-card__head{display:flex;justify-content:space-between;align-items:center;margin-bottom:11px}.fact-card__head b{color:var(--green);font-size:11px}.fact-links{display:flex;flex-wrap:wrap;gap:8px}.check-field{display:flex;align-items:center;gap:6px;font-size:12px;color:#53625c}.check-field input{accent-color:var(--green)}.empty-inline{font-size:12px;color:var(--muted);margin:12px 0}.section-title>div h2{margin-bottom:3px}@media(max-width:900px){.editor-layout{grid-template-columns:1fr}.editor-side{position:static;grid-row:1}.editor-actions{width:100%;flex-wrap:wrap}.editor-actions .button{flex:1}}
</style>
