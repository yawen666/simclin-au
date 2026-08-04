import axios, { type AxiosInstance } from 'axios'
import type { AuthResponse, ClinicalCase, ClinicalSession, EvaluationResult, Insights, Role, Rubric, RubricCriterion } from '@/types'

const TOKEN_KEY = 'simclin-demo-token'
const USER_KEY = 'simclin-demo-user'
const VISITOR_KEY = 'simclin-visitor-id'
export const AUTH_EXPIRED_EVENT = 'simclin:auth-expired'

function visitorId() {
  const stored = localStorage.getItem(VISITOR_KEY)
  if (stored && /^[A-Za-z0-9_-]{12,128}$/.test(stored)) return stored
  if (stored) localStorage.removeItem(VISITOR_KEY)
  const created = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  localStorage.setItem(VISITOR_KEY, created)
  return created
}

export function expireAuthSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
}

class ApiClient {
  readonly http: AxiosInstance
  constructor() {
    this.http = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api', timeout: 30_000 })
    this.http.interceptors.request.use((config) => {
      const token = localStorage.getItem(TOKEN_KEY)
      if (token) config.headers.Authorization = `Bearer ${token}`
      return config
    })
    this.http.interceptors.response.use(
      response => response,
      (error) => {
        if (axios.isAxiosError(error) && error.response?.status === 401 && localStorage.getItem(TOKEN_KEY)) {
          expireAuthSession()
        }
        return Promise.reject(error)
      },
    )
  }
  setToken(token: string) { localStorage.setItem(TOKEN_KEY, token) }
  clearToken() { localStorage.removeItem(TOKEN_KEY) }
  resetVisitor() { localStorage.removeItem(VISITOR_KEY) }
  getToken() { return localStorage.getItem(TOKEN_KEY) }

  async demoLogin(role: Role, accessCode?: string) { const { data } = await this.http.post<AuthResponse>('/auth/demo', { role, ...(role === 'student' ? { visitorId: visitorId() } : {}), ...(accessCode ? { accessCode } : {}) }); this.setToken(data.token); return data }
  async getCases(params?: { status?: string }) {
    const data = (await this.http.get<{ cases?: ClinicalCase[]; items?: ClinicalCase[] }>('/cases', { params })).data
    const cases = data.cases ?? data.items ?? []
    return { items: cases.map(normaliseCase) }
  }
  async getCase(id: string) {
    const data = (await this.http.get<ClinicalCase & { case?: ClinicalCase }>(`/cases/${id}`)).data
    return normaliseCase(data.case ?? data)
  }
  async createCase(payload: Partial<ClinicalCase>) {
    const data = (await this.http.post<ClinicalCase & { case?: ClinicalCase }>('/cases', casePayload(payload))).data
    return normaliseCase(data.case ?? data)
  }
  async updateCase(id: string, payload: Partial<ClinicalCase>) {
    const data = (await this.http.patch<ClinicalCase & { case?: ClinicalCase }>(`/cases/${id}`, casePayload(payload, false))).data
    return normaliseCase(data.case ?? data)
  }
  async caseAction(id: string, action: 'publish' | 'archive' | 'duplicate' | 'preview') {
    const data = (await this.http.post<ClinicalCase & { case?: ClinicalCase }>(`/cases/${id}/${action}`)).data
    return action === 'publish' ? normaliseCase(data.case ?? data) : data
  }
  async previewCaseResponse(id: string, message: string) {
    return (await this.http.post<{ text: string; disclosedFactIds: string[]; permittedFacts: Array<{ id?: string; label?: string; value?: string }>; model: string }>(`/cases/${id}/preview/respond`, { message }, { timeout: 90_000 })).data
  }

  async getRubrics() { const data = (await this.http.get<{ rubrics?: Rubric[]; items?: Rubric[] }>('/rubrics')).data; return { items: (data.rubrics ?? data.items ?? []).map(normaliseRubric) } }
  async getRubric(id: string) { const data = (await this.http.get<Rubric & { rubric?: Rubric }>(`/rubrics/${id}`)).data; return normaliseRubric(data.rubric ?? data) }
  async createRubric(payload: Partial<Rubric>) { const created = (await this.http.post<{ id: string }>('/rubrics', rubricPayload(payload, true))).data; return this.getRubric(String(created.id)) }
  async updateRubric(id: string, payload: Partial<Rubric>) { await this.http.patch(`/rubrics/${id}`, rubricPayload(payload, false)); return this.getRubric(id) }
  async rubricAction(id: string, action: 'publish' | 'archive') { await this.http.post(`/rubrics/${id}/${action}`); return this.getRubric(id) }

  async startSession(caseId: string) { const data = (await this.http.post<ClinicalSession & { session?: ClinicalSession }>('/sessions', { caseId })).data; return data.session ?? data }
  async getSession(id: string) { const data = (await this.http.get<ClinicalSession & { session?: ClinicalSession }>(`/sessions/${id}`)).data; return data.session ?? data }
  async getSessions() { return (await this.http.get<{ items: ClinicalSession[] } | ClinicalSession[]>('/sessions')).data }
  async completeSession(id: string) {
    // Keep the explicit empty object for compatibility with existing API clients.
    const data = (await this.http.post<{
      status: 'evaluating' | 'completed'
      sessionId?: string
      message?: string
      resultId?: string
      result?: { id: string }
      session?: ClinicalSession
    }>(`/sessions/${id}/complete`, {})).data
    return { ...data, resultId: data.resultId ?? String(data.result?.id ?? '') }
  }

  async getResults(params?: { limit?: number; offset?: number; query?: string; review?: 'all' | 'adjusted' | 'unadjusted' }) {
    const data = (await this.http.get<{ items: EvaluationResult[]; total?: number; limit?: number; offset?: number } | EvaluationResult[]>('/results', { params })).data
    if (Array.isArray(data)) return { items: data, total: data.length, limit: data.length, offset: 0 }
    return { ...data, total: data.total ?? data.items.length, limit: data.limit ?? data.items.length, offset: data.offset ?? 0 }
  }
  async getResult(id: string) {
    const data = (await this.http.get<EvaluationResult & { result?: EvaluationResult; turns?: Array<EvaluationResult['transcript'][number] & { speaker?: 'student' | 'patient' }> }>(`/results/${id}`)).data
    const result = data.result ?? data
    const transcript = result.transcript?.length ? result.transcript : (data.turns ?? []).map((turn) => ({ ...turn, role: turn.role ?? turn.speaker ?? 'patient' }))
    return { ...result, transcript }
  }
  async overrideResult(id: string, payload: { score?: number; comment: string }) { const data = (await this.http.post<EvaluationResult & { result?: EvaluationResult }>(`/results/${id}/override`, { score: payload.score, reason: payload.comment })).data; return data.result ?? data }
  async getInsights() { return (await this.http.get<Insights>('/insights')).data }
}

export const api = new ApiClient()

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || `case-${Date.now()}`
}

function normaliseCase(value: ClinicalCase): ClinicalCase {
  const anyCase = value as ClinicalCase & { summary?: string; estimatedMinutes?: number; rubric?: { id?: string | number } }
  const caseData = value.content?.caseData as Record<string, unknown> | undefined
  const taskSource = value.task ?? caseData?.candidateInstructions ?? ''
  return {
    ...value,
    id: String(value.id),
    subtitle: value.subtitle ?? anyCase.summary ?? '',
    durationMinutes: value.durationMinutes ?? anyCase.estimatedMinutes ?? 10,
    task: Array.isArray(taskSource) ? taskSource.join('\n') : String(taskSource),
    learningObjectives: value.learningObjectives ?? [],
    presentingComplaint: value.presentingComplaint ?? (typeof caseData?.presentingComplaint === 'string' ? caseData.presentingComplaint : undefined),
    openingStatement: value.openingStatement ?? (typeof value.content?.openingStatement === 'string' ? value.content.openingStatement : ''),
    atomicFacts: value.atomicFacts ?? (Array.isArray(caseData?.atomicFacts) ? caseData.atomicFacts as ClinicalCase['atomicFacts'] : []),
    redFlags: ((value.redFlags ?? (Array.isArray(caseData?.redFlags) ? caseData.redFlags as ClinicalCase['redFlags'] : [])) ?? []).map(flag => ({ ...flag, linkedFactIds: flag.linkedFactIds ?? [], requiredQuestions: flag.requiredQuestions ?? [] })),
    unknownPolicy: value.unknownPolicy ?? (caseData?.unknownPolicy as ClinicalCase['unknownPolicy'] | undefined),
    patientActorRules: value.patientActorRules ?? (Array.isArray(caseData?.patientActorRules) ? caseData.patientActorRules as string[] : []),
    rubricId: value.rubricId ?? (anyCase.rubric?.id != null ? String(anyCase.rubric.id) : undefined),
  }
}

function casePayload(value: Partial<ClinicalCase>, includeSlug = true) {
  const source = value.content ?? {}
  const existingPatient = (source.patient as Record<string, unknown> | undefined) ?? {}
  const existingCaseData = (source.caseData as Record<string, unknown> | undefined) ?? value.caseData ?? {}
  const content = {
    ...source,
    patient: { ...existingPatient, name: value.patientName, age: value.patientAge },
    caseData: {
      ...existingCaseData,
      candidateInstructions: value.task,
      learningObjectives: value.learningObjectives ?? [],
      presentingComplaint: value.presentingComplaint,
      atomicFacts: (value.atomicFacts ?? []).map((fact, index) => ({
        ...fact,
        id: fact.id.trim() || `${slugify(value.title || 'case')}.fact.${String(index + 1).padStart(2, '0')}`,
      })),
      redFlags: (value.redFlags ?? []).map((flag) => ({
        ...flag,
        id: flag.id.trim(),
        linkedFactIds: [...new Set((flag.linkedFactIds ?? []).map(id => id.trim()).filter(Boolean))],
      })),
      unknownPolicy: value.unknownPolicy ?? existingCaseData.unknownPolicy,
      patientActorRules: value.patientActorRules ?? (Array.isArray(existingCaseData.patientActorRules) ? existingCaseData.patientActorRules as string[] : []),
    },
    openingStatement: value.openingStatement,
  }
  return {
    ...(includeSlug ? { slug: value.slug || slugify(value.title || 'new case') } : {}),
    title: value.title,
    specialty: value.specialty,
    setting: value.setting,
    summary: value.subtitle,
    difficulty: value.difficulty,
    estimatedMinutes: value.durationMinutes,
    content,
    rubricId: value.rubricId ? Number(value.rubricId) : undefined,
  }
}

function rubricPayload(value: Partial<Rubric>, includeSlug: boolean) {
  return {
    ...(includeSlug ? { slug: value.slug || slugify(value.name || 'new rubric') } : {}),
    name: value.name,
    description: value.description ?? '',
    criteria: value.criteria?.map((criterion) => ({ ...criterion, label: criterion.name })),
  }
}

function normaliseRubric(value: Rubric): Rubric {
  return {
    ...value,
    id: String(value.id),
    criteria: (value.criteria ?? []).map((criterion) => ({
      ...criterion,
      name: criterion.name || (criterion as RubricCriterion & { label?: string }).label || criterion.id,
      anchors: Array.isArray(criterion.anchors) ? criterion.anchors : [],
    })),
  }
}
export function unpack<T>(value: { items: T[] } | T[]): T[] { return Array.isArray(value) ? value : value.items }
export function apiError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { message?: string } | undefined)?.message
    if (message) return message
    if (error.code === 'ECONNABORTED') return 'The request took too long. Please try again.'
    if (!error.response) return 'The service is temporarily unreachable. Check your connection and try again.'
    return fallback
  }
  return error instanceof Error ? error.message : fallback
}
