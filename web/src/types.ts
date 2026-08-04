export type Role = 'student' | 'faculty'
export type CaseStatus = 'draft' | 'published' | 'archived'
export interface AtomicFact {
  id: string
  label: string
  value: string
  category: string
  disclosureLevel: string
  triggers?: string[]
  importance?: string
  assessmentTags?: string[]
}
export interface CaseRedFlag {
  id: string
  label: string
  linkedFactIds: string[]
  critical?: boolean
  requiredQuestions?: string[]
}

export interface DemoUser { id: string; name: string; role: Role; programme?: string }
export interface AuthResponse { token: string; user: DemoUser }

export interface ClinicalCase {
  id: string
  slug?: string
  title: string
  subtitle: string
  specialty: string
  setting: string
  difficulty: 'Year 2' | 'Year 3' | 'Year 4' | 'Foundation' | 'Intermediate' | 'Advanced'
  durationMinutes: number
  status: CaseStatus
  version: number
  task: string
  learningObjectives: string[]
  patientName?: string
  patientAge?: number
  presentingComplaint?: string
  openingStatement?: string
  atomicFacts?: AtomicFact[]
  redFlags?: CaseRedFlag[]
  unknownPolicy?: Record<string, unknown>
  patientActorRules?: string[]
  updatedAt?: string
  attempts?: number
  medianScore?: number | null
  rubricId?: string
  caseData?: Record<string, unknown>
  content?: Record<string, unknown>
}

export interface RubricCriterion {
  id: string
  name: string
  description: string
  weight: number
  critical?: boolean
  redFlagIds?: string[]
  anchors: { score: number; label: string; description: string }[]
}
export interface Rubric { id: string; slug?: string; name: string; description?: string; version: number; publishedVersion?: number | null; status: CaseStatus; criteria: RubricCriterion[]; updatedAt?: string }

export interface SessionTurn { id: string; role: 'student' | 'patient'; content: string; createdAt?: string }
export interface ClinicalSession {
  id: string
  caseId: string
  caseTitle: string
  status: 'active' | 'evaluating' | 'evaluation_failed' | 'completed'
  evaluationStatus?: 'not_started' | 'queued' | 'running' | 'completed' | 'failed'
  evaluationError?: string | null
  startedAt: string
  completedAt?: string
  durationSeconds?: number
  turns: SessionTurn[]
  result?: EvaluationResult | null
  score?: number
  resultId?: string
}

export interface CriterionResult {
  criterionId: string
  name: string
  score: number
  maxScore: number
  weight: number
  weightedScore: number
  level: string
  feedback: string
  evidenceStatus?: 'covered' | 'asked_no_credit' | 'not_asked'
  evidence: { turnId: string; quote: string }[]
}
export interface EvaluationResult {
  id: string
  sessionId: string
  caseId: string
  caseTitle: string
  studentName: string
  score: number
  aiScore?: number
  level: string
  summary: string
  strengths: string[]
  improvements: string[]
  scoringVersion?: string
  scoringFormula?: string
  scoringRoundingRule?: string
  totalWeight?: number
  uncappedScore?: number
  capApplied?: number | null
  scoreCapReason?: string | null
  missedRedFlagIds?: string[]
  missedRedFlags: string[]
  missedRedFlagReasons?: Record<string, string>
  criteria: CriterionResult[]
  transcript: SessionTurn[]
  createdAt: string
  completedAt?: string
  durationSeconds?: number
  adjusted?: boolean
  teacherScore?: number | null
  teacherComment?: string | null
}

export interface DashboardStats { publishedCases: number; totalAttempts: number; completionRate: number; medianScore: number }
export interface Insights {
  stats: DashboardStats
  scoreDistribution: { label: string; value: number }[]
  domainScores: { name: string; value: number }[]
  commonMisses: { label: string; count: number }[]
  recentResults: EvaluationResult[]
  aiQuality?: {
    totalRuns: number
    successfulRuns: number
    failedRuns: number
    successRate: number
    averageLatencyMs: number
    inputTokens: number
    outputTokens: number
    byPurpose: { purpose: string; total: number; successful: number; averageLatencyMs: number }[]
    recentRuns: { provider: string; model: string; purpose: string; promptVersion: string; latencyMs: number; status: string; errorCode?: string; createdAt: string }[]
  }
}
