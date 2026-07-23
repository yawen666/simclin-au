/**
 * Synthetic educational seed content for SimClin AU.
 *
 * The people and encounters below are fictional. This content is an educator-
 * review draft for formative undergraduate history-taking practice; it is not
 * a clinical guideline, a diagnostic tool, or an expert-approved assessment.
 * Stable case, fact, red-flag and rubric IDs are intentionally retained so
 * transcripts and evaluations can be traced to a specific content version.
 */

export type CaseDifficulty = "Year 2" | "Year 3" | "Year 4";

export type DisclosureLevel =
  | "opening"
  | "broad_question"
  | "direct_question"
  | "specific_question";

export type FactImportance = "context" | "core" | "critical";

export interface AtomicCaseFact {
  id: string;
  category:
    | "presenting_complaint"
    | "associated_symptoms"
    | "red_flag"
    | "past_history"
    | "medication"
    | "allergy"
    | "family_history"
    | "social_history"
    | "functional_impact"
    | "patient_perspective";
  label: string;
  value: string;
  disclosureLevel: DisclosureLevel;
  triggers: string[];
  assessmentTags: string[];
  importance: FactImportance;
}

export interface RedFlagDefinition {
  id: string;
  label: string;
  clinicalConcern: string;
  requiredQuestions: string[];
  linkedFactIds: string[];
  critical: boolean;
}

export interface CriticalHistoryItem {
  id: string;
  label: string;
  expectedBehaviour: string;
  linkedFactIds: string[];
  consequenceIfMissed: string;
}

export interface PatientPersona {
  id: string;
  name: string;
  age: number;
  genderIdentity: string;
  pronouns: string;
  occupation: string;
  livesWith: string;
  preferredLanguage: string;
  communicationStyle: string;
  emotionalState: string;
  healthLiteracy: string;
  culturalOrCommunicationNeeds: string;
  actorNotes: string[];
}

export interface CaseData {
  schemaVersion: "1.0";
  contentVersion: string;
  contentStatus: "synthetic-educational-draft";
  syntheticNotice: string;
  expertApprovalStatus: "not-reviewed";
  intendedLearners: string;
  learningObjectives: string[];
  candidateInstructions: string[];
  patientActorRules: string[];
  clinicalTruth: {
    likelyDiagnosis: string;
    timeCriticalDifferentials: string[];
    currentSafetyContext: string;
    evaluatorOnlyNote: string;
  };
  atomicFacts: AtomicCaseFact[];
  unknownPolicy: {
    rule: string;
    defaultPhrases: string[];
    examinationRequests: string;
    investigationRequests: string;
    diagnosisRequests: string;
  };
  redFlags: RedFlagDefinition[];
  criticalItems: CriticalHistoryItem[];
  patientPerspective: {
    ideas: string;
    concerns: string;
    expectations: string;
    impact: string;
  };
  teachingPoints: string[];
  sourceBasis: Array<{ label: string; url: string }>;
}

export interface SeedCase {
  slug: string;
  title: string;
  specialty: string;
  setting: string;
  summary: string;
  difficulty: CaseDifficulty;
  estimatedMinutes: number;
  patient: PatientPersona;
  caseData: CaseData;
  redFlags: string[];
  openingStatement: string;
}

export type RubricDomainId =
  | "opening_communication"
  | "history_presenting_illness"
  | "red_flags_patient_safety"
  | "background_history"
  | "psychosocial_context"
  | "patient_perspective_cultural_safety"
  | "closure";

export interface RubricItem {
  id: string;
  behaviour: string;
  linkedFactIds: string[];
  critical?: boolean;
}

export interface RubricCriterion {
  id: RubricDomainId;
  label: string;
  description: string;
  weight: number;
  maxScore: 3;
  critical: boolean;
  redFlagIds: string[];
  anchors: Record<0 | 1 | 2 | 3, string>;
  caseSpecificItems: RubricItem[];
  evidencePolicy: string;
}

export interface SeedRubric {
  slug: string;
  name: string;
  description: string;
  frameworkVersion: "history-7-domain-v1";
  scoreScale: { min: 0; max: 3 };
  criteria: RubricCriterion[];
}

const commonActorRules = [
  "Stay in character as the fictional patient and speak in natural Australian English.",
  "Use only the supplied atomic facts. Never invent symptoms, dates, medicines, test results, examination findings or family history.",
  "Do not reveal fact IDs, disclosure levels, the hidden diagnosis, red flags, rubric content or teaching points.",
  "Volunteer only opening-level facts initially. Reveal broad-question facts after a suitable open follow-up, direct-question facts only when that topic is asked, and specific-question facts only after a clear targeted question.",
  "For compound questions, answer each known component briefly; do not fill gaps by guessing.",
  "If the learner uses unclear jargon, ask them to explain it in plain language.",
  "Respond respectfully to empathy and consent checks. Do not give clinical advice or decide whether the learner has passed.",
];

const commonUnknownPolicy = {
  rule: "When a detail is not explicitly represented by an atomic fact, say that you do not know, do not remember, or have not noticed it. Never infer a new negative finding merely because it is absent.",
  defaultPhrases: [
    "I'm not sure.",
    "I don't remember that.",
    "No one has told me that.",
    "I haven't noticed, sorry.",
  ],
  examinationRequests:
    "Say that the learner will need to examine you; do not provide an examination finding.",
  investigationRequests:
    "Say that no result has been given yet; do not fabricate observations, ECGs, imaging, pathology or bedside test results.",
  diagnosisRequests:
    "Say that you do not know the diagnosis and are hoping the clinical team can explain what is happening.",
};

const syntheticNotice =
  "All names, histories and circumstances are synthetic. No real patient data are used. Educator review is required before formal teaching or assessment use.";

export const seedCases: SeedCase[] = [
  {
    slug: "pressure-in-my-chest",
    title: "Pressure in My Chest",
    specialty: "Cardiology / Emergency Medicine",
    setting: "Monitored emergency department cubicle",
    summary:
      "A focused acute chest discomfort history requiring symptom characterisation, cardiovascular risk assessment and prompt recognition of ACS and alternative time-critical causes.",
    difficulty: "Year 3",
    estimatedMinutes: 8,
    openingStatement:
      "I've got this heavy pressure in the middle of my chest, and it isn't going away.",
    patient: {
      id: "pt-chest-001",
      name: "Rachel Morgan",
      age: 58,
      genderIdentity: "woman",
      pronouns: "she/her",
      occupation: "Hairdresser",
      livesWith: "Her partner, Jo",
      preferredLanguage: "English",
      communicationStyle:
        "Short, worried answers at first; gives a clear chronology when asked one question at a time.",
      emotionalState:
        "Frightened and uncomfortable; becomes more anxious if the learner minimises the symptoms.",
      healthLiteracy: "Everyday health knowledge; does not use medical terminology.",
      culturalOrCommunicationNeeds:
        "None volunteered. Do not invent ethnicity, religion or cultural identity.",
      actorNotes: [
        "Keep one hand over the centre of the chest and sound uncomfortable, but remain able to converse.",
        "Do not volunteer cardiovascular risk factors until asked.",
        "If the learner recognises urgency and calls a supervisor, remain in character and say, 'Okay, thank you.'",
      ],
    },
    redFlags: [
      "Ongoing central pressure lasting more than 20 minutes",
      "Radiation to jaw and left arm",
      "Dyspnoea, nausea and diaphoresis",
      "Recent crescendo exertional episodes",
      "Multiple cardiovascular risk factors",
    ],
    caseData: {
      schemaVersion: "1.0",
      contentVersion: "chest-acs-1.0.0",
      contentStatus: "synthetic-educational-draft",
      syntheticNotice,
      expertApprovalStatus: "not-reviewed",
      intendedLearners: "Australian medical students, Years 2–4",
      learningObjectives: [
        "Characterise acute chest discomfort using a focused chronology and relevant descriptors.",
        "Elicit associated ischaemic symptoms and cardiovascular risk factors without relying on stereotypes.",
        "Screen for ACS and important alternative emergencies, including aortic dissection, pulmonary embolism and pneumothorax.",
        "Recognise an active time-critical presentation and communicate immediate concern to the supervising clinician.",
      ],
      candidateInstructions: [
        "You are a medical student in a monitored emergency department cubicle. A supervising clinician is nearby and observations and an ECG are being arranged.",
        "Take a focused history of the presenting problem. You have 8 minutes.",
        "This station assesses questioning and patient communication only; no clinical summary, differential list or management plan is required.",
        "Verbalise an immediate safety concern as soon as you recognise one. Do not request examination or investigation results from the patient.",
      ],
      patientActorRules: commonActorRules,
      clinicalTruth: {
        likelyDiagnosis: "Acute coronary syndrome until proven otherwise",
        timeCriticalDifferentials: [
          "Acute aortic syndrome",
          "Pulmonary embolism",
          "Pneumothorax",
          "Myopericarditis",
        ],
        currentSafetyContext:
          "Ongoing symptoms in a monitored ED setting. The learner should identify urgency during the history and involve the supervisor.",
        evaluatorOnlyNote:
          "Do not award diagnostic certainty. Credit focused risk recognition and safe escalation language.",
      },
      atomicFacts: [
        { id: "chest.pc.01", category: "presenting_complaint", label: "Main symptom", value: "Heavy pressure in the centre of the chest", disclosureLevel: "opening", triggers: ["what brought you in", "tell me what happened", "main problem"], assessmentTags: ["chief_complaint"], importance: "critical" },
        { id: "chest.hpi.01", category: "presenting_complaint", label: "Onset", value: "Started suddenly 30 minutes ago while carrying grocery bags uphill from the car park", disclosureLevel: "broad_question", triggers: ["when did it start", "what were you doing", "onset"], assessmentTags: ["onset", "exertion"], importance: "critical" },
        { id: "chest.hpi.02", category: "presenting_complaint", label: "Duration and course", value: "It has been continuous and has not eased after sitting down for about 25 minutes", disclosureLevel: "direct_question", triggers: ["how long", "constant", "gone away", "rest"], assessmentTags: ["duration", "ongoing_pain"], importance: "critical" },
        { id: "chest.hpi.03", category: "presenting_complaint", label: "Character", value: "A heavy squeezing pressure, not a sharp pain", disclosureLevel: "direct_question", triggers: ["what does it feel like", "character", "sharp", "pressure"], assessmentTags: ["character"], importance: "core" },
        { id: "chest.hpi.04", category: "presenting_complaint", label: "Severity", value: "Eight out of ten", disclosureLevel: "direct_question", triggers: ["how severe", "out of ten", "pain score"], assessmentTags: ["severity"], importance: "core" },
        { id: "chest.hpi.05", category: "presenting_complaint", label: "Radiation", value: "Spreads into the left arm and up into the jaw", disclosureLevel: "direct_question", triggers: ["does it spread", "radiate", "arm", "jaw"], assessmentTags: ["radiation"], importance: "critical" },
        { id: "chest.hpi.06", category: "presenting_complaint", label: "Previous episodes", value: "Two shorter episodes this week while walking quickly; each settled within about five minutes of rest", disclosureLevel: "specific_question", triggers: ["ever happened before", "previous episodes", "earlier pain"], assessmentTags: ["crescendo_pattern"], importance: "critical" },
        { id: "chest.assoc.01", category: "associated_symptoms", label: "Breathlessness", value: "Feels short of breath with the pressure", disclosureLevel: "direct_question", triggers: ["short of breath", "breathing"], assessmentTags: ["anginal_equivalent"], importance: "critical" },
        { id: "chest.assoc.02", category: "associated_symptoms", label: "Autonomic symptoms", value: "Feels sweaty and nauseated but has not vomited", disclosureLevel: "direct_question", triggers: ["sweating", "nausea", "vomiting", "clammy"], assessmentTags: ["associated_ischaemic_symptoms"], importance: "critical" },
        { id: "chest.assoc.03", category: "red_flag", label: "Syncope and palpitations", value: "No fainting, near-fainting or racing heartbeat", disclosureLevel: "specific_question", triggers: ["fainted", "dizzy", "palpitations", "heart racing"], assessmentTags: ["haemodynamic_red_flags"], importance: "core" },
        { id: "chest.diff.01", category: "red_flag", label: "Pleuritic or positional features", value: "Not worse with a deep breath, movement, position or pressing on the chest", disclosureLevel: "specific_question", triggers: ["deep breath", "position", "movement", "pressing", "tender"], assessmentTags: ["alternative_causes"], importance: "core" },
        { id: "chest.diff.02", category: "red_flag", label: "Aortic features", value: "No tearing pain and no pain through to the back", disclosureLevel: "specific_question", triggers: ["tearing", "back", "aorta"], assessmentTags: ["aortic_dissection_screen"], importance: "core" },
        { id: "chest.diff.03", category: "red_flag", label: "Pulmonary embolism features", value: "No coughing blood, unilateral calf pain or leg swelling, recent surgery, long travel or immobilisation", disclosureLevel: "specific_question", triggers: ["coughing blood", "calf", "leg swelling", "travel", "surgery", "immobile"], assessmentTags: ["pe_screen"], importance: "core" },
        { id: "chest.pmh.01", category: "past_history", label: "Cardiovascular history", value: "Has high blood pressure and high cholesterol; no known heart attack, angina or stroke", disclosureLevel: "direct_question", triggers: ["medical problems", "heart history", "blood pressure", "cholesterol", "stroke"], assessmentTags: ["cardiovascular_risk"], importance: "core" },
        { id: "chest.pmh.02", category: "past_history", label: "Diabetes", value: "Has never been diagnosed with diabetes", disclosureLevel: "specific_question", triggers: ["diabetes", "blood sugar"], assessmentTags: ["cardiovascular_risk"], importance: "core" },
        { id: "chest.med.01", category: "medication", label: "Regular medicines", value: "Ramipril 5 mg daily and atorvastatin 20 mg at night, but misses both several days most weeks", disclosureLevel: "direct_question", triggers: ["medications", "tablets", "ramipril", "statin", "take regularly"], assessmentTags: ["medication_history", "adherence"], importance: "core" },
        { id: "chest.med.02", category: "medication", label: "Antithrombotic medicines", value: "Does not take aspirin, antiplatelets or anticoagulants", disclosureLevel: "specific_question", triggers: ["aspirin", "blood thinner", "anticoagulant"], assessmentTags: ["medication_history"], importance: "context" },
        { id: "chest.allergy.01", category: "allergy", label: "Allergies", value: "Penicillin caused an itchy rash as a teenager; no breathing or facial swelling", disclosureLevel: "direct_question", triggers: ["allergies", "reaction", "penicillin"], assessmentTags: ["allergy_history"], importance: "core" },
        { id: "chest.fh.01", category: "family_history", label: "Premature cardiovascular disease", value: "Her father had a heart attack at 52", disclosureLevel: "direct_question", triggers: ["family history", "heart attack in family", "parents"], assessmentTags: ["cardiovascular_risk"], importance: "core" },
        { id: "chest.sh.01", category: "social_history", label: "Smoking", value: "Smokes about 10 cigarettes daily and has done so for 30 years", disclosureLevel: "direct_question", triggers: ["smoke", "cigarettes", "vape", "pack years"], assessmentTags: ["cardiovascular_risk"], importance: "core" },
        { id: "chest.sh.02", category: "social_history", label: "Alcohol and other drugs", value: "Usually four standard drinks per week and no cocaine, methamphetamine or other recreational drugs", disclosureLevel: "specific_question", triggers: ["alcohol", "recreational drugs", "cocaine", "methamphetamine"], assessmentTags: ["social_risk"], importance: "context" },
        { id: "chest.sh.03", category: "social_history", label: "Home support", value: "Lives with her partner, Jo, who drove her to hospital and is in the waiting room", disclosureLevel: "direct_question", triggers: ["live with", "support", "who brought you"], assessmentTags: ["support"], importance: "context" },
        { id: "chest.ice.01", category: "patient_perspective", label: "Concern", value: "She is frightened this could be a heart attack because of what happened to her father", disclosureLevel: "direct_question", triggers: ["worried", "concern", "what do you think"], assessmentTags: ["ice", "empathy"], importance: "core" },
        { id: "chest.ice.02", category: "patient_perspective", label: "Expectation", value: "She wants someone to tell her quickly whether her heart is in danger", disclosureLevel: "direct_question", triggers: ["hoping", "expect", "how can we help"], assessmentTags: ["ice"], importance: "context" },
      ],
      unknownPolicy: commonUnknownPolicy,
      redFlags: [
        { id: "chest.rf.ongoing", label: "Ongoing ischaemic-pattern pain", clinicalConcern: "Possible active acute coronary syndrome", requiredQuestions: ["onset", "duration", "current or resolved", "exertional trigger", "severity"], linkedFactIds: ["chest.hpi.01", "chest.hpi.02", "chest.hpi.04", "chest.hpi.06"], critical: true },
        { id: "chest.rf.associated", label: "Associated ischaemic symptoms", clinicalConcern: "Higher-risk acute coronary presentation", requiredQuestions: ["breathlessness", "sweating", "nausea or vomiting", "syncope"], linkedFactIds: ["chest.assoc.01", "chest.assoc.02", "chest.assoc.03"], critical: true },
        { id: "chest.rf.alternatives", label: "Alternative time-critical chest pain causes", clinicalConcern: "Aortic dissection, pulmonary embolism or pneumothorax", requiredQuestions: ["tearing or back pain", "pleuritic pain", "haemoptysis", "DVT or immobilisation risk"], linkedFactIds: ["chest.diff.01", "chest.diff.02", "chest.diff.03"], critical: false },
      ],
      criticalItems: [
        { id: "chest.critical.timeline", label: "Establishes active symptom timeline", expectedBehaviour: "Elicits onset, ongoing duration and exertional context early.", linkedFactIds: ["chest.hpi.01", "chest.hpi.02"], consequenceIfMissed: "Major safety omission; red-flags domain cannot score above 1/3." },
        { id: "chest.critical.escalation", label: "Recognises need for immediate escalation", expectedBehaviour: "States that ongoing concerning chest pressure requires immediate supervisor/team attention rather than completing a routine history first.", linkedFactIds: ["chest.pc.01", "chest.hpi.02", "chest.assoc.01", "chest.assoc.02"], consequenceIfMissed: "Overall performance level is capped at Needs development." },
      ],
      patientPerspective: {
        ideas: "She thinks it may be indigestion but also wonders whether it is her heart.",
        concerns: "She is afraid of having a heart attack like her father.",
        expectations: "Prompt explanation and action from the clinical team.",
        impact: "She stopped walking, could not carry the shopping and needed her partner to drive her.",
      },
      teachingPoints: [
        "Ask about discomfort, pressure and heaviness as well as the word pain.",
        "Character, radiation, exertion, duration and associated symptoms inform risk but do not diagnose or exclude ACS by themselves.",
        "A focused history should also screen for other time-critical causes of chest pain.",
        "Ongoing concerning symptoms require early escalation; a complete checklist should not delay care.",
      ],
      sourceBasis: [
        { label: "Australian clinical guideline for diagnosing and managing acute coronary syndromes 2025", url: "https://www.heartfoundation.org.au/for-professionals/acs-guideline" },
      ],
    },
  },
  {
    slug: "cant-catch-my-breath",
    title: "I Can't Catch My Breath",
    specialty: "Respiratory Medicine / General Medicine",
    setting: "Emergency department assessment area",
    summary:
      "A patient with COPD and a likely infective exacerbation requiring severity assessment, symptom change, medication use and screening for dangerous respiratory and cardiac alternatives.",
    difficulty: "Year 3",
    estimatedMinutes: 9,
    openingStatement:
      "My breathing's been getting worse for three days, and today even walking to the bathroom leaves me puffed.",
    patient: {
      id: "pt-breath-001",
      name: "David Nguyen",
      age: 67,
      genderIdentity: "man",
      pronouns: "he/him",
      occupation: "Retired bus driver",
      livesWith: "His wife, Linh",
      preferredLanguage: "English",
      communicationStyle:
        "Cooperative and direct; answers in short sentences because of breathlessness.",
      emotionalState:
        "Tired and worried about being admitted, but not panicked or confused.",
      healthLiteracy: "Understands COPD, puffers and flare-ups in everyday terms.",
      culturalOrCommunicationNeeds:
        "None requested. Do not infer communication needs from his name or background.",
      actorNotes: [
        "Pause briefly between longer answers but remain able to speak complete sentences.",
        "Do not portray cyanosis, confusion or collapse.",
        "Call inhalers 'puffers' unless the learner asks for names.",
      ],
    },
    redFlags: [
      "New breathlessness at rest and major reduction in exercise tolerance",
      "Increased rescue inhaler use",
      "Increased cough with purulent sputum",
      "Need to exclude chest pain, haemoptysis, syncope, confusion and thromboembolic symptoms",
    ],
    caseData: {
      schemaVersion: "1.0",
      contentVersion: "resp-copd-1.0.0",
      contentStatus: "synthetic-educational-draft",
      syntheticNotice,
      expertApprovalStatus: "not-reviewed",
      intendedLearners: "Australian medical students, Years 2–4",
      learningObjectives: [
        "Define onset, trajectory and functional severity of breathlessness.",
        "Characterise cough and sputum change in a patient with COPD.",
        "Assess rescue and maintenance inhaler use, adherence and previous exacerbation severity.",
        "Screen for respiratory compromise, pneumonia, ACS, heart failure, pulmonary embolism and pneumothorax.",
      ],
      candidateInstructions: [
        "You are a medical student assessing a patient in the emergency department. A nurse is obtaining observations and a supervisor is available.",
        "Take a focused history of the breathing problem. You have 9 minutes.",
        "This station assesses questioning and patient communication only; no clinical summary, differential list or management plan is required.",
        "If the history suggests immediate deterioration, verbalise the concern promptly. Do not ask the patient for examination or investigation findings.",
      ],
      patientActorRules: commonActorRules,
      clinicalTruth: {
        likelyDiagnosis: "Acute exacerbation of COPD, likely triggered by a respiratory infection",
        timeCriticalDifferentials: [
          "Pneumonia with respiratory compromise",
          "Acute coronary syndrome",
          "Acute heart failure",
          "Pulmonary embolism",
          "Pneumothorax",
        ],
        currentSafetyContext:
          "Clinically concerning symptom escalation but conversationally stable in an ED assessment area.",
        evaluatorOnlyNote:
          "Credit explicit severity and deterioration screening. Do not infer examination signs from the actor's written style.",
      },
      atomicFacts: [
        { id: "breath.pc.01", category: "presenting_complaint", label: "Main symptom", value: "Breathing has become much worse over three days", disclosureLevel: "opening", triggers: ["what brought you in", "breathing", "main problem"], assessmentTags: ["chief_complaint"], importance: "critical" },
        { id: "breath.hpi.01", category: "presenting_complaint", label: "Onset and course", value: "Gradual worsening over three days, not a sudden onset", disclosureLevel: "broad_question", triggers: ["when", "how did it start", "sudden", "getting worse"], assessmentTags: ["onset", "trajectory"], importance: "critical" },
        { id: "breath.hpi.02", category: "functional_impact", label: "Current exercise tolerance", value: "Usually walks to the local shops slowly; today must stop after walking from the bedroom to the bathroom", disclosureLevel: "direct_question", triggers: ["how far can you walk", "exercise tolerance", "usual breathing", "daily activities"], assessmentTags: ["severity", "baseline_comparison"], importance: "critical" },
        { id: "breath.hpi.03", category: "red_flag", label: "Breathlessness at rest", value: "Mildly short of breath while sitting but can speak complete sentences", disclosureLevel: "specific_question", triggers: ["at rest", "full sentences", "talking", "how severe right now"], assessmentTags: ["respiratory_severity"], importance: "critical" },
        { id: "breath.assoc.01", category: "associated_symptoms", label: "Cough", value: "Cough is more frequent than usual", disclosureLevel: "broad_question", triggers: ["other symptoms", "cough"], assessmentTags: ["respiratory_symptoms"], importance: "core" },
        { id: "breath.assoc.02", category: "associated_symptoms", label: "Sputum", value: "Bringing up more phlegm than usual; it changed from clear to yellow-green", disclosureLevel: "direct_question", triggers: ["phlegm", "sputum", "colour", "amount"], assessmentTags: ["infective_features", "copd_exacerbation"], importance: "critical" },
        { id: "breath.assoc.03", category: "associated_symptoms", label: "Fever and infective contact", value: "Felt hot and shivery last night; his wife had a cold last week", disclosureLevel: "direct_question", triggers: ["fever", "chills", "sick contact", "infection"], assessmentTags: ["infective_features"], importance: "core" },
        { id: "breath.assoc.04", category: "associated_symptoms", label: "Wheeze", value: "More wheezy and tight in the chest than usual", disclosureLevel: "direct_question", triggers: ["wheeze", "tight chest"], assessmentTags: ["airflow_obstruction"], importance: "core" },
        { id: "breath.rf.01", category: "red_flag", label: "Severe respiratory compromise symptoms", value: "No blue lips, drowsiness, confusion, collapse or inability to speak", disclosureLevel: "specific_question", triggers: ["blue", "confused", "drowsy", "collapsed", "speak", "walk"], assessmentTags: ["respiratory_failure_screen"], importance: "critical" },
        { id: "breath.rf.02", category: "red_flag", label: "Chest pain and palpitations", value: "No chest pain, pressure, palpitations or fainting", disclosureLevel: "specific_question", triggers: ["chest pain", "pressure", "heart racing", "faint"], assessmentTags: ["cardiac_screen"], importance: "critical" },
        { id: "breath.rf.03", category: "red_flag", label: "Haemoptysis", value: "Has not coughed up blood", disclosureLevel: "specific_question", triggers: ["coughing blood", "haemoptysis", "blood in sputum"], assessmentTags: ["respiratory_red_flag"], importance: "critical" },
        { id: "breath.rf.04", category: "red_flag", label: "Thromboembolic risk", value: "No one-sided calf pain or swelling, recent operation, long travel, cancer or prolonged immobility", disclosureLevel: "specific_question", triggers: ["leg swelling", "calf", "travel", "operation", "immobile", "clot", "cancer"], assessmentTags: ["pe_screen"], importance: "core" },
        { id: "breath.rf.05", category: "red_flag", label: "Heart failure symptoms", value: "Sleeps on one pillow and has no breathlessness lying flat, waking breathless or ankle swelling", disclosureLevel: "specific_question", triggers: ["lie flat", "pillows", "wake at night", "ankle swelling", "orthopnoea"], assessmentTags: ["heart_failure_screen"], importance: "core" },
        { id: "breath.pmh.01", category: "past_history", label: "COPD history", value: "Diagnosed with COPD six years ago after spirometry at the GP clinic", disclosureLevel: "direct_question", triggers: ["lung problems", "COPD", "diagnosed", "spirometry"], assessmentTags: ["past_respiratory_history"], importance: "core" },
        { id: "breath.pmh.02", category: "past_history", label: "Previous exacerbations", value: "Last hospital admission was 18 months ago; never needed intensive care, ventilation or home oxygen", disclosureLevel: "specific_question", triggers: ["admitted before", "ICU", "ventilation", "oxygen", "previous flare"], assessmentTags: ["exacerbation_risk"], importance: "core" },
        { id: "breath.pmh.03", category: "past_history", label: "Other history", value: "Has high blood pressure; no known heart failure, coronary disease, asthma or previous blood clot", disclosureLevel: "direct_question", triggers: ["medical history", "heart failure", "heart disease", "asthma", "blood clot"], assessmentTags: ["comorbidity"], importance: "core" },
        { id: "breath.med.01", category: "medication", label: "Maintenance inhalers", value: "Uses tiotropium once daily and budesonide/formoterol two puffs twice daily; usually remembers them", disclosureLevel: "direct_question", triggers: ["regular inhalers", "puffers", "tiotropium", "budesonide", "formoterol", "adherence"], assessmentTags: ["medication_history"], importance: "core" },
        { id: "breath.med.02", category: "medication", label: "Reliever use", value: "Usually uses salbutamol once or twice a week, but since yesterday has taken four puffs every two hours with only brief relief", disclosureLevel: "specific_question", triggers: ["salbutamol", "blue puffer", "reliever", "how often", "help"], assessmentTags: ["severity", "medication_response"], importance: "critical" },
        { id: "breath.med.03", category: "medication", label: "Other medicines", value: "Takes amlodipine 5 mg daily; no sedatives or opioids", disclosureLevel: "direct_question", triggers: ["other medications", "tablets", "sedative", "opioid"], assessmentTags: ["medication_history"], importance: "context" },
        { id: "breath.allergy.01", category: "allergy", label: "Allergies", value: "No known medication allergies", disclosureLevel: "direct_question", triggers: ["allergies", "reaction"], assessmentTags: ["allergy_history"], importance: "core" },
        { id: "breath.sh.01", category: "social_history", label: "Smoking exposure", value: "Smoked about 20 cigarettes daily for 42 years and stopped two years ago; does not vape", disclosureLevel: "direct_question", triggers: ["smoke", "cigarettes", "quit", "pack years", "vape"], assessmentTags: ["smoking_history"], importance: "core" },
        { id: "breath.sh.02", category: "social_history", label: "Home and function", value: "Lives with his wife in a single-storey home; normally independent with personal care", disclosureLevel: "direct_question", triggers: ["live with", "home", "support", "independent", "personal care"], assessmentTags: ["support", "baseline_function"], importance: "context" },
        { id: "breath.sh.03", category: "social_history", label: "Vaccination", value: "Had COVID boosters but missed this year's influenza vaccination", disclosureLevel: "specific_question", triggers: ["vaccination", "flu vaccine", "COVID"], assessmentTags: ["prevention"], importance: "context" },
        { id: "breath.ice.01", category: "patient_perspective", label: "Concern", value: "He is worried because the blue puffer is not lasting and remembers his previous hospital stay", disclosureLevel: "direct_question", triggers: ["worried", "concern", "what do you think"], assessmentTags: ["ice", "empathy"], importance: "core" },
        { id: "breath.ice.02", category: "patient_perspective", label: "Expectation", value: "He wants help breathing but hopes he will not have to stay overnight", disclosureLevel: "direct_question", triggers: ["hoping", "expect", "what can we do"], assessmentTags: ["ice"], importance: "context" },
      ],
      unknownPolicy: commonUnknownPolicy,
      redFlags: [
        { id: "breath.rf.severity", label: "Current respiratory severity", clinicalConcern: "Impending respiratory failure or rapid deterioration", requiredQuestions: ["breathlessness at rest", "ability to speak and walk", "drowsiness or confusion", "cyanosis", "trajectory"], linkedFactIds: ["breath.hpi.01", "breath.hpi.02", "breath.hpi.03", "breath.rf.01"], critical: true },
        { id: "breath.rf.alternatives", label: "Dangerous alternative causes", clinicalConcern: "ACS, pulmonary embolism, pneumothorax or acute heart failure", requiredQuestions: ["chest pain", "sudden onset", "haemoptysis", "syncope", "DVT risk", "orthopnoea or oedema"], linkedFactIds: ["breath.hpi.01", "breath.rf.02", "breath.rf.03", "breath.rf.04", "breath.rf.05"], critical: true },
        { id: "breath.rf.exacerbation", label: "COPD exacerbation burden", clinicalConcern: "Clinically significant COPD flare", requiredQuestions: ["change from baseline", "sputum amount and colour", "reliever frequency and response", "previous ICU or ventilation"], linkedFactIds: ["breath.hpi.02", "breath.assoc.02", "breath.med.02", "breath.pmh.02"], critical: true },
      ],
      criticalItems: [
        { id: "breath.critical.severity", label: "Assesses ability to breathe, speak and function", expectedBehaviour: "Compares current function with baseline and asks about rest symptoms, speech, cyanosis and altered consciousness.", linkedFactIds: ["breath.hpi.02", "breath.hpi.03", "breath.rf.01"], consequenceIfMissed: "Red-flags domain cannot score above 1/3." },
        { id: "breath.critical.reliever", label: "Quantifies rescue inhaler escalation", expectedBehaviour: "Asks which reliever, how much, how often and whether it helps.", linkedFactIds: ["breath.med.02"], consequenceIfMissed: "Major omission in HPI and background medication assessment." },
      ],
      patientPerspective: {
        ideas: "He thinks this is another COPD flare, possibly from his wife's cold.",
        concerns: "The reliever is no longer lasting; he worries about a severe flare and hospital admission.",
        expectations: "Relief of breathlessness and a clear explanation of what happens next.",
        impact: "He cannot walk across his home without stopping and needed his wife to help him dress.",
      },
      teachingPoints: [
        "Quantify breathlessness by change from baseline and concrete functional limits, not only a 0–10 score.",
        "Changes in cough, sputum volume and sputum colour are important in a suspected COPD exacerbation.",
        "Ask about reliever frequency and effect as well as the medication list.",
        "Do not anchor on COPD: screen for respiratory compromise and important cardiac, thromboembolic and pleural alternatives.",
      ],
      sourceBasis: [
        { label: "Lung Foundation Australia — symptoms of COPD and flare-up warning signs", url: "https://lungfoundation.com.au/lung-diseases/copd/symptoms/" },
        { label: "healthdirect — shortness of breath", url: "https://www.healthdirect.gov.au/shortness-of-breath" },
      ],
    },
  },
  {
    slug: "burning-pain-after-meals",
    title: "Burning Pain After Meals",
    specialty: "Gastroenterology / General Medicine",
    setting: "Same-day acute general practice clinic",
    summary:
      "An epigastric pain history with recent regular NSAID exposure and symptoms concerning for an upper gastrointestinal bleed.",
    difficulty: "Year 3",
    estimatedMinutes: 9,
    openingStatement:
      "I've had a burning pain high in my stomach for about ten days, and since yesterday I've felt really light-headed.",
    patient: {
      id: "pt-epigastric-001",
      name: "Priya Shah",
      age: 53,
      genderIdentity: "woman",
      pronouns: "she/her",
      occupation: "Accountant",
      livesWith: "Her husband",
      preferredLanguage: "English",
      communicationStyle:
        "Polite and precise but initially embarrassed to discuss stool colour unless asked directly and neutrally.",
      emotionalState:
        "Concerned the pain could be cancer; becomes reassured by calm, non-judgmental questions.",
      healthLiteracy: "Recognises the term reflux but not melaena or gastrointestinal bleeding.",
      culturalOrCommunicationNeeds:
        "None requested. Do not infer beliefs or preferences from her name.",
      actorNotes: [
        "Call the stool 'black and sticky like tar'; do not use the word melaena unless the learner explains it.",
        "Do not volunteer ibuprofen frequency until medicines or painkillers are specifically explored.",
        "If asked several sensitive questions at once, answer the stool question first and wait for follow-up.",
      ],
    },
    redFlags: [
      "Two episodes of black tarry stool",
      "Postural light-headedness",
      "Regular high-frequency NSAID use",
      "Need to exclude haematemesis, syncope, perforation and other upper abdominal emergencies",
    ],
    caseData: {
      schemaVersion: "1.0",
      contentVersion: "gi-nsaid-bleed-1.0.0",
      contentStatus: "synthetic-educational-draft",
      syntheticNotice,
      expertApprovalStatus: "not-reviewed",
      intendedLearners: "Australian medical students, Years 2–4",
      learningObjectives: [
        "Characterise epigastric pain and related upper gastrointestinal symptoms.",
        "Ask explicitly and sensitively about haematemesis and stool colour or consistency.",
        "Identify NSAIDs, antithrombotic medicines and alcohol as relevant exposure history.",
        "Recognise symptoms concerning for gastrointestinal bleeding and communicate urgency.",
      ],
      candidateInstructions: [
        "You are a medical student in a same-day acute general practice clinic. The supervising GP is immediately available.",
        "Take a focused history of the abdominal symptom. You have 9 minutes.",
        "This station assesses questioning and patient communication only; no clinical summary, differential list or management plan is required.",
        "Verbalise an immediate safety concern if one emerges. Do not ask the patient for examination or investigation findings.",
      ],
      patientActorRules: commonActorRules,
      clinicalTruth: {
        likelyDiagnosis: "NSAID-associated peptic ulcer disease with suspected upper gastrointestinal bleeding",
        timeCriticalDifferentials: [
          "Significant upper gastrointestinal haemorrhage",
          "Perforated peptic ulcer",
          "Acute coronary syndrome presenting as epigastric discomfort",
          "Pancreatobiliary disease",
        ],
        currentSafetyContext:
          "Black stool plus postural symptoms require prompt senior assessment; the patient is currently alert and conversational.",
        evaluatorOnlyNote:
          "The station tests whether the learner elicits bleeding and medication risk. Do not reward reassurance based on age or conversational stability.",
      },
      atomicFacts: [
        { id: "epi.pc.01", category: "presenting_complaint", label: "Main symptom", value: "Burning pain high in the middle of the abdomen for ten days", disclosureLevel: "opening", triggers: ["what brought you in", "pain", "main problem"], assessmentTags: ["chief_complaint"], importance: "core" },
        { id: "epi.hpi.01", category: "presenting_complaint", label: "Onset and course", value: "Came on gradually and has become more frequent over ten days", disclosureLevel: "broad_question", triggers: ["when did it start", "how has it changed", "onset"], assessmentTags: ["onset", "course"], importance: "core" },
        { id: "epi.hpi.02", category: "presenting_complaint", label: "Site", value: "In the epigastrium, just below the breastbone; she points with one finger to the upper midline", disclosureLevel: "direct_question", triggers: ["where", "site", "point"], assessmentTags: ["site"], importance: "core" },
        { id: "epi.hpi.03", category: "presenting_complaint", label: "Character and severity", value: "Burning or gnawing, usually six out of ten", disclosureLevel: "direct_question", triggers: ["feel like", "character", "how bad", "out of ten"], assessmentTags: ["character", "severity"], importance: "core" },
        { id: "epi.hpi.04", category: "presenting_complaint", label: "Timing and food relationship", value: "Often starts 20–30 minutes after eating and can last one to two hours; it woke her once last night", disclosureLevel: "direct_question", triggers: ["meals", "food", "how long", "night", "timing"], assessmentTags: ["timing", "aggravating_factors"], importance: "core" },
        { id: "epi.hpi.05", category: "presenting_complaint", label: "Radiation", value: "Does not spread to the back, chest, shoulder or arm", disclosureLevel: "specific_question", triggers: ["spread", "radiate", "back", "chest", "shoulder", "arm"], assessmentTags: ["differential_screen"], importance: "core" },
        { id: "epi.hpi.06", category: "presenting_complaint", label: "Relieving factors", value: "Chewable antacid helps for about half an hour; food does not reliably relieve it", disclosureLevel: "direct_question", triggers: ["better", "relieve", "antacid", "food"], assessmentTags: ["relieving_factors"], importance: "context" },
        { id: "epi.assoc.01", category: "associated_symptoms", label: "Nausea and vomiting", value: "Mild nausea but no vomiting", disclosureLevel: "direct_question", triggers: ["nausea", "vomiting", "sick"], assessmentTags: ["associated_gi_symptoms"], importance: "core" },
        { id: "epi.rf.01", category: "red_flag", label: "Black stool", value: "Had two black, sticky, unusually smelly bowel motions since yesterday", disclosureLevel: "specific_question", triggers: ["stool colour", "black stool", "tarry", "blood in stool", "bowels"], assessmentTags: ["upper_gi_bleed"], importance: "critical" },
        { id: "epi.rf.02", category: "red_flag", label: "Haematemesis", value: "No vomit with red blood or coffee-ground material", disclosureLevel: "specific_question", triggers: ["vomit blood", "coffee grounds", "haematemesis"], assessmentTags: ["upper_gi_bleed"], importance: "critical" },
        { id: "epi.rf.03", category: "red_flag", label: "Haemodynamic symptoms", value: "Light-headed when standing since this morning; no fainting, collapse, chest pressure or shortness of breath", disclosureLevel: "specific_question", triggers: ["light-headed", "standing", "faint", "collapse", "chest pressure", "short of breath"], assessmentTags: ["bleeding_severity", "cardiac_screen"], importance: "critical" },
        { id: "epi.rf.04", category: "red_flag", label: "Perforation features", value: "No sudden knife-like pain, no pain throughout the whole abdomen and no abrupt major deterioration", disclosureLevel: "specific_question", triggers: ["sudden severe", "knife", "whole abdomen", "worse suddenly", "perforation"], assessmentTags: ["perforation_screen"], importance: "critical" },
        { id: "epi.rf.05", category: "red_flag", label: "Malignancy and obstruction features", value: "No unintentional weight loss, progressive difficulty swallowing, painful swallowing or persistent vomiting", disclosureLevel: "specific_question", triggers: ["weight loss", "swallow", "food stuck", "persistent vomiting"], assessmentTags: ["alarm_features"], importance: "core" },
        { id: "epi.assoc.02", category: "associated_symptoms", label: "Biliary and pancreatic features", value: "No right upper abdominal pain, back radiation, jaundice, pale stool or dark urine", disclosureLevel: "specific_question", triggers: ["right side", "back", "jaundice", "yellow", "dark urine", "pale stool"], assessmentTags: ["hepatobiliary_screen"], importance: "context" },
        { id: "epi.pmh.01", category: "past_history", label: "Previous gastrointestinal history", value: "Occasional reflux in the past but no known ulcer, gastrointestinal bleed, liver disease or previous endoscopy", disclosureLevel: "direct_question", triggers: ["stomach problems", "ulcer", "bleed", "liver", "endoscopy", "reflux"], assessmentTags: ["past_gi_history"], importance: "core" },
        { id: "epi.pmh.02", category: "past_history", label: "Other history", value: "Knee osteoarthritis; no known coronary disease or bleeding disorder", disclosureLevel: "direct_question", triggers: ["medical history", "other conditions", "heart disease", "bleeding disorder"], assessmentTags: ["past_history"], importance: "core" },
        { id: "epi.med.01", category: "medication", label: "NSAID exposure", value: "Has taken over-the-counter ibuprofen 400 mg three times daily for three weeks for a painful knee, usually without food", disclosureLevel: "specific_question", triggers: ["ibuprofen", "anti-inflammatory", "NSAID", "painkiller", "over the counter", "how often"], assessmentTags: ["ulcer_risk", "medication_history"], importance: "critical" },
        { id: "epi.med.02", category: "medication", label: "Antithrombotic and steroid exposure", value: "Does not take aspirin, clopidogrel, anticoagulants or oral steroids", disclosureLevel: "specific_question", triggers: ["aspirin", "blood thinner", "anticoagulant", "steroid", "prednisone"], assessmentTags: ["bleeding_risk"], importance: "critical" },
        { id: "epi.med.03", category: "medication", label: "Other medicines", value: "Only a daily vitamin D tablet and occasional chewable antacid", disclosureLevel: "direct_question", triggers: ["medications", "tablets", "antacid", "supplements"], assessmentTags: ["medication_history"], importance: "context" },
        { id: "epi.allergy.01", category: "allergy", label: "Allergies", value: "No known medication allergies", disclosureLevel: "direct_question", triggers: ["allergies", "reaction"], assessmentTags: ["allergy_history"], importance: "core" },
        { id: "epi.fh.01", category: "family_history", label: "Family gastrointestinal history", value: "No close family history of ulcer or upper gastrointestinal cancer; her father developed bowel cancer at 75", disclosureLevel: "direct_question", triggers: ["family history", "stomach cancer", "bowel cancer", "ulcer"], assessmentTags: ["family_history"], importance: "context" },
        { id: "epi.sh.01", category: "social_history", label: "Alcohol", value: "Usually drinks two glasses of wine most evenings, about 12 standard drinks per week", disclosureLevel: "direct_question", triggers: ["alcohol", "wine", "how much"], assessmentTags: ["alcohol_history"], importance: "core" },
        { id: "epi.sh.02", category: "social_history", label: "Smoking and drugs", value: "Does not smoke, vape or use recreational drugs", disclosureLevel: "direct_question", triggers: ["smoke", "vape", "recreational drugs"], assessmentTags: ["social_history"], importance: "context" },
        { id: "epi.sh.03", category: "functional_impact", label: "Daily impact", value: "Left work early today because of the light-headedness and pain; her husband drove her", disclosureLevel: "direct_question", triggers: ["impact", "work", "daily life", "who brought you"], assessmentTags: ["functional_impact", "support"], importance: "core" },
        { id: "epi.ice.01", category: "patient_perspective", label: "Concern", value: "She worries it could be stomach cancer, although the black stool has also frightened her", disclosureLevel: "direct_question", triggers: ["worried", "concern", "what do you think"], assessmentTags: ["ice", "empathy"], importance: "core" },
        { id: "epi.ice.02", category: "patient_perspective", label: "Expectation", value: "She wants the cause explained and the pain stopped", disclosureLevel: "direct_question", triggers: ["hoping", "expect", "how can we help"], assessmentTags: ["ice"], importance: "context" },
      ],
      unknownPolicy: commonUnknownPolicy,
      redFlags: [
        { id: "epi.rf.bleeding", label: "Evidence of upper gastrointestinal bleeding", clinicalConcern: "Potential clinically significant upper gastrointestinal haemorrhage", requiredQuestions: ["black or tarry stool", "red blood in stool", "haematemesis or coffee-ground vomit", "number and timing of episodes"], linkedFactIds: ["epi.rf.01", "epi.rf.02"], critical: true },
        { id: "epi.rf.instability", label: "Symptoms of blood loss or instability", clinicalConcern: "Haemodynamic compromise from bleeding", requiredQuestions: ["postural light-headedness", "syncope or collapse", "breathlessness", "chest discomfort"], linkedFactIds: ["epi.rf.03"], critical: true },
        { id: "epi.rf.exposure", label: "Ulcer and bleeding medication exposure", clinicalConcern: "NSAID-associated mucosal injury and amplified bleeding risk", requiredQuestions: ["NSAIDs including over-the-counter products", "dose and frequency", "aspirin or antiplatelets", "anticoagulants", "steroids"], linkedFactIds: ["epi.med.01", "epi.med.02"], critical: true },
        { id: "epi.rf.perforation", label: "Perforation symptoms", clinicalConcern: "Perforated peptic ulcer or other acute abdomen", requiredQuestions: ["sudden severe pain", "abrupt deterioration", "generalised pain"], linkedFactIds: ["epi.rf.04"], critical: false },
      ],
      criticalItems: [
        { id: "epi.critical.bleed", label: "Asks directly about gastrointestinal bleeding", expectedBehaviour: "Uses plain, specific questions about vomit and stool colour, character and timing.", linkedFactIds: ["epi.rf.01", "epi.rf.02"], consequenceIfMissed: "Red-flags domain scores 0/3 and overall performance is capped at Needs development." },
        { id: "epi.critical.nsaid", label: "Elicits over-the-counter NSAID use", expectedBehaviour: "Asks about prescribed and non-prescribed analgesics, then quantifies drug, dose, frequency and duration.", linkedFactIds: ["epi.med.01"], consequenceIfMissed: "Major case-specific omission; background domain cannot score above 1/3." },
        { id: "epi.critical.escalation", label: "Escalates suspected bleed", expectedBehaviour: "Recognises the combination of black stool and light-headedness as requiring immediate supervisor review.", linkedFactIds: ["epi.rf.01", "epi.rf.03"], consequenceIfMissed: "Overall performance level is capped at Needs development." },
      ],
      patientPerspective: {
        ideas: "She initially thinks reflux or an ulcer is possible.",
        concerns: "She fears cancer and is newly frightened by the black stool and light-headedness.",
        expectations: "Explanation, pain relief and guidance about whether the situation is serious.",
        impact: "Pain interrupts meals and sleep; light-headedness made her leave work and avoid driving.",
      },
      teachingPoints: [
        "Patients may not recognise melaena; ask about black, tarry, sticky or unusually offensive stool in plain language.",
        "Medication history must include over-the-counter NSAIDs and quantify dose, frequency and duration.",
        "Ask about postural symptoms, syncope, breathlessness and chest symptoms when bleeding is possible.",
        "A focused epigastric pain history should still consider perforation, pancreatobiliary causes and cardiac presentations.",
      ],
      sourceBasis: [
        { label: "healthdirect — duodenal ulcer and urgent bleeding symptoms", url: "https://www.healthdirect.gov.au/duodenal-ulcer" },
        { label: "healthdirect — anti-inflammatory medicines (NSAIDs)", url: "https://www.healthdirect.gov.au/anti-inflammatory-medicines" },
      ],
    },
  },
  {
    slug: "worst-headache",
    title: "The Worst Headache?",
    specialty: "Neurology / Emergency Medicine",
    setting: "Emergency department cubicle",
    summary:
      "A first thunderclap headache requiring precise onset-to-peak timing, comparison with previous migraine and systematic secondary-headache red-flag screening.",
    difficulty: "Year 4",
    estimatedMinutes: 8,
    openingStatement:
      "I was lifting weights and suddenly got the worst headache of my life. It hit me like a bolt.",
    patient: {
      id: "pt-headache-001",
      name: "Emma Li",
      age: 42,
      genderIdentity: "woman",
      pronouns: "she/her",
      occupation: "Secondary school teacher",
      livesWith: "Her wife and their teenage son",
      preferredLanguage: "English",
      communicationStyle:
        "Clear but distressed; answers best to brief questions because talking worsens nausea.",
      emotionalState: "Frightened, in severe pain and worried about a family history of aneurysm.",
      healthLiteracy: "Knows migraine terminology from previous episodes but does not know thunderclap headache.",
      culturalOrCommunicationNeeds:
        "Prefers low light because of photophobia; no other needs requested. Do not infer ethnicity or cultural identity.",
      actorNotes: [
        "Keep eyes partly closed and answers concise, but remain fully oriented.",
        "Do not call this a migraine unless explaining that previous migraines felt different.",
        "If the learner verbalises urgent escalation, respond with relief rather than requesting a diagnosis.",
      ],
    },
    redFlags: [
      "Instantaneous severe headache reaching maximum intensity within seconds",
      "Onset during exertion",
      "Vomiting and neck stiffness",
      "Markedly different from previous migraine",
      "Family history of cerebral aneurysm",
    ],
    caseData: {
      schemaVersion: "1.0",
      contentVersion: "neuro-thunderclap-1.0.0",
      contentStatus: "synthetic-educational-draft",
      syntheticNotice,
      expertApprovalStatus: "not-reviewed",
      intendedLearners: "Australian medical students, Years 2–4",
      learningObjectives: [
        "Establish exact onset and time to peak intensity in a severe acute headache.",
        "Differentiate the presentation from the patient's established migraine pattern.",
        "Screen for neurological deficit, meningism or infection, seizure, trauma, pregnancy-related risk and relevant medicines or substances.",
        "Recognise a thunderclap headache as a medical emergency requiring immediate escalation.",
      ],
      candidateInstructions: [
        "You are a medical student in the emergency department. The patient's observations are being obtained and a supervising clinician is nearby.",
        "Take a focused headache history. You have 8 minutes.",
        "This station assesses questioning and patient communication only; no clinical summary, differential list or management plan is required.",
        "Verbalise immediate safety concerns as soon as they become apparent. Do not ask the patient for examination or investigation findings.",
      ],
      patientActorRules: commonActorRules,
      clinicalTruth: {
        likelyDiagnosis: "Thunderclap headache requiring urgent exclusion of subarachnoid haemorrhage",
        timeCriticalDifferentials: [
          "Subarachnoid haemorrhage",
          "Other intracranial haemorrhage",
          "Cervical artery dissection",
          "Meningitis or encephalitis",
          "Cerebral venous sinus thrombosis",
        ],
        currentSafetyContext:
          "A high-risk first thunderclap headache in ED; the learner should stop routine questioning and alert the supervisor once onset is established.",
        evaluatorOnlyNote:
          "Do not let a past migraine history reduce the safety score. The instantaneous onset and different pattern are decisive red flags.",
      },
      atomicFacts: [
        { id: "head.pc.01", category: "presenting_complaint", label: "Main symptom", value: "Sudden worst-ever headache while lifting weights", disclosureLevel: "opening", triggers: ["what happened", "headache", "main problem"], assessmentTags: ["chief_complaint", "thunderclap"], importance: "critical" },
        { id: "head.hpi.01", category: "presenting_complaint", label: "Exact onset", value: "Began 55 minutes ago during a heavy deadlift at the gym", disclosureLevel: "broad_question", triggers: ["when", "what were you doing", "onset", "exertion"], assessmentTags: ["onset", "exertional_trigger"], importance: "critical" },
        { id: "head.hpi.02", category: "red_flag", label: "Time to peak", value: "Reached maximum intensity in less than ten seconds, like a bolt or explosion", disclosureLevel: "specific_question", triggers: ["sudden", "how quickly", "maximum", "peak", "seconds", "thunderclap"], assessmentTags: ["thunderclap"], importance: "critical" },
        { id: "head.hpi.03", category: "presenting_complaint", label: "Site and radiation", value: "Started at the back of the head and immediately spread over the whole head and upper neck", disclosureLevel: "direct_question", triggers: ["where", "site", "spread", "neck", "back of head"], assessmentTags: ["site", "radiation"], importance: "core" },
        { id: "head.hpi.04", category: "presenting_complaint", label: "Character and severity", value: "Explosive, pounding pain that remains ten out of ten", disclosureLevel: "direct_question", triggers: ["feel like", "character", "severity", "out of ten"], assessmentTags: ["character", "severity"], importance: "core" },
        { id: "head.hpi.05", category: "presenting_complaint", label: "Course", value: "Still constant and severe; lying still in a dark room helps only slightly", disclosureLevel: "direct_question", triggers: ["constant", "better", "worse", "course"], assessmentTags: ["course"], importance: "core" },
        { id: "head.assoc.01", category: "associated_symptoms", label: "Vomiting and photophobia", value: "Vomited once and finds bright light unpleasant", disclosureLevel: "direct_question", triggers: ["vomit", "nausea", "light", "photophobia"], assessmentTags: ["associated_neurological_symptoms"], importance: "critical" },
        { id: "head.assoc.02", category: "red_flag", label: "Neck stiffness", value: "Neck feels unusually stiff, not just sore from exercise", disclosureLevel: "specific_question", triggers: ["neck stiff", "bend neck", "meningism"], assessmentTags: ["meningism", "subarachnoid_red_flag"], importance: "critical" },
        { id: "head.rf.01", category: "red_flag", label: "Focal neurological symptoms", value: "No weakness, numbness, facial droop, speech difficulty, loss of balance, double vision or loss of vision", disclosureLevel: "specific_question", triggers: ["weak", "numb", "face", "speech", "balance", "double vision", "vision loss"], assessmentTags: ["focal_neurology_screen"], importance: "critical" },
        { id: "head.rf.02", category: "red_flag", label: "Consciousness and seizure", value: "No loss of consciousness, confusion or seizure; remembers the entire event", disclosureLevel: "specific_question", triggers: ["passed out", "conscious", "confused", "seizure", "remember"], assessmentTags: ["intracranial_red_flag"], importance: "critical" },
        { id: "head.rf.03", category: "red_flag", label: "Infection features", value: "No fever, chills, recent infection or rash", disclosureLevel: "specific_question", triggers: ["fever", "infection", "rash", "chills"], assessmentTags: ["meningitis_screen"], importance: "critical" },
        { id: "head.rf.04", category: "red_flag", label: "Trauma", value: "No fall, blow to the head or neck manipulation", disclosureLevel: "specific_question", triggers: ["injury", "hit head", "fall", "neck manipulation", "chiropractor"], assessmentTags: ["trauma_dissection_screen"], importance: "core" },
        { id: "head.rf.05", category: "red_flag", label: "Pregnancy and postpartum status", value: "Not pregnant; last menstrual period was two weeks ago and no pregnancy in the past year", disclosureLevel: "specific_question", triggers: ["pregnant", "period", "postpartum", "recent baby"], assessmentTags: ["cvst_preeclampsia_screen"], importance: "core" },
        { id: "head.pmh.01", category: "past_history", label: "Previous migraine pattern", value: "Had three migraines in her twenties: gradual visual zigzags followed over 30 minutes by one-sided headache; none was sudden and none felt like this", disclosureLevel: "direct_question", triggers: ["headaches before", "migraine", "usual headache", "same or different"], assessmentTags: ["pattern_comparison"], importance: "critical" },
        { id: "head.pmh.02", category: "past_history", label: "Other history", value: "No diagnosed hypertension, cancer, clotting disorder, polycystic kidney disease or connective tissue disorder", disclosureLevel: "direct_question", triggers: ["medical history", "blood pressure", "cancer", "clotting", "kidney", "connective tissue"], assessmentTags: ["secondary_headache_risk"], importance: "core" },
        { id: "head.med.01", category: "medication", label: "Medicines", value: "Takes no regular prescription medicines and no anticoagulants, antiplatelets, hormonal contraception or hormone therapy", disclosureLevel: "specific_question", triggers: ["medications", "blood thinner", "aspirin", "contraception", "hormone"], assessmentTags: ["bleeding_cvst_risk"], importance: "core" },
        { id: "head.med.02", category: "medication", label: "Self-treatment", value: "Took two paracetamol tablets at the gym with no benefit", disclosureLevel: "direct_question", triggers: ["taken anything", "paracetamol", "pain relief", "helped"], assessmentTags: ["treatment_response"], importance: "context" },
        { id: "head.allergy.01", category: "allergy", label: "Allergies", value: "No known medication allergies", disclosureLevel: "direct_question", triggers: ["allergies", "reaction"], assessmentTags: ["allergy_history"], importance: "context" },
        { id: "head.fh.01", category: "family_history", label: "Aneurysm history", value: "A maternal aunt survived a ruptured brain aneurysm at 51", disclosureLevel: "direct_question", triggers: ["family history", "aneurysm", "brain bleed", "stroke"], assessmentTags: ["aneurysm_risk"], importance: "core" },
        { id: "head.sh.01", category: "social_history", label: "Smoking and substances", value: "Smokes about five cigarettes a day; no cocaine, methamphetamine, performance-enhancing drugs or recent binge drinking", disclosureLevel: "specific_question", triggers: ["smoke", "cocaine", "methamphetamine", "stimulant", "performance enhancing", "alcohol"], assessmentTags: ["vascular_risk", "substance_screen"], importance: "core" },
        { id: "head.sh.02", category: "social_history", label: "Support and immediate context", value: "A gym staff member called an ambulance; her wife knows she is in hospital", disclosureLevel: "direct_question", triggers: ["who brought you", "support", "family knows", "live with"], assessmentTags: ["support"], importance: "context" },
        { id: "head.ice.01", category: "patient_perspective", label: "Concern", value: "She is terrified it may be a brain aneurysm because of her aunt", disclosureLevel: "direct_question", triggers: ["worried", "concern", "what do you think"], assessmentTags: ["ice", "empathy"], importance: "core" },
        { id: "head.ice.02", category: "patient_perspective", label: "Expectation", value: "She wants the team to act quickly and help the pain and nausea", disclosureLevel: "direct_question", triggers: ["hoping", "expect", "how can we help"], assessmentTags: ["ice"], importance: "context" },
      ],
      unknownPolicy: commonUnknownPolicy,
      redFlags: [
        { id: "head.rf.thunderclap", label: "Thunderclap onset", clinicalConcern: "Subarachnoid haemorrhage or another vascular emergency", requiredQuestions: ["exact onset time", "activity at onset", "time to peak intensity", "worst-ever or different pattern"], linkedFactIds: ["head.hpi.01", "head.hpi.02", "head.hpi.04", "head.pmh.01"], critical: true },
        { id: "head.rf.neurological", label: "Neurological compromise", clinicalConcern: "Intracranial haemorrhage, stroke or seizure", requiredQuestions: ["focal weakness or sensory change", "speech or vision change", "loss of consciousness", "confusion", "seizure"], linkedFactIds: ["head.rf.01", "head.rf.02"], critical: true },
        { id: "head.rf.meningism", label: "Meningism or infection", clinicalConcern: "Subarachnoid blood or central nervous system infection", requiredQuestions: ["neck stiffness", "fever", "rash", "photophobia", "vomiting"], linkedFactIds: ["head.assoc.01", "head.assoc.02", "head.rf.03"], critical: true },
        { id: "head.rf.context", label: "Secondary headache risk context", clinicalConcern: "Trauma, pregnancy-related conditions, medicines or substance-associated vascular events", requiredQuestions: ["trauma or neck manipulation", "pregnancy or postpartum", "anticoagulants and hormones", "stimulant drugs"], linkedFactIds: ["head.rf.04", "head.rf.05", "head.med.01", "head.sh.01"], critical: false },
      ],
      criticalItems: [
        { id: "head.critical.peak", label: "Establishes time to maximum intensity", expectedBehaviour: "Asks explicitly whether pain peaked in seconds, minutes or longer, not merely when it began.", linkedFactIds: ["head.hpi.01", "head.hpi.02"], consequenceIfMissed: "Red-flags domain cannot score above 1/3." },
        { id: "head.critical.escalation", label: "Escalates thunderclap headache immediately", expectedBehaviour: "Alerts the supervisor once instantaneous worst-ever onset is elicited, while continuing only essential safety questions.", linkedFactIds: ["head.pc.01", "head.hpi.02"], consequenceIfMissed: "Overall performance level is capped at Needs development." },
      ],
      patientPerspective: {
        ideas: "She briefly wondered whether it was a severe migraine but knows the onset and pain are completely different.",
        concerns: "She fears a ruptured aneurysm because of her aunt.",
        expectations: "Urgent assessment and relief of severe pain and nausea.",
        impact: "The pain stopped her workout instantly; she lay on the floor until the ambulance arrived.",
      },
      teachingPoints: [
        "In acute headache, time from onset to maximum intensity is a separate and essential question.",
        "A previous migraine diagnosis does not explain a first sudden, severe and distinctly different headache.",
        "Screen systematically for neurological deficit, altered consciousness, seizure, meningism, trauma, pregnancy-related risk, medicines and stimulant substances.",
        "A thunderclap history should prompt immediate escalation before a routine exhaustive interview is completed.",
      ],
      sourceBasis: [
        { label: "RACGP — management of chronic headache: headache red flags", url: "https://www.racgp.org.au/afp/2014/march/chronic-headache/" },
        { label: "healthdirect — urgent features in sudden severe headache", url: "https://www.healthdirect.gov.au/headaches" },
      ],
    },
  },
  {
    slug: "always-thirsty",
    title: "Always Thirsty",
    specialty: "Endocrinology / General Medicine",
    setting: "University health general practice clinic",
    summary:
      "A young adult with progressive osmotic symptoms and weight loss requiring a focused diabetes history and active screening for diabetic ketoacidosis.",
    difficulty: "Year 2",
    estimatedMinutes: 9,
    openingStatement:
      "I'm thirsty all the time and going to the toilet constantly. It's been getting worse for about a month.",
    patient: {
      id: "pt-diabetes-001",
      name: "Liam Brooks",
      age: 22,
      genderIdentity: "man",
      pronouns: "he/him",
      occupation: "University engineering student and casual café worker",
      livesWith: "Two housemates",
      preferredLanguage: "English",
      communicationStyle:
        "Friendly and conversational; initially attributes symptoms to study stress and hot weather.",
      emotionalState:
        "Tired and mildly anxious after his mother suggested diabetes, but not acutely distressed.",
      healthLiteracy: "Basic understanding of type 2 diabetes through his mother; little knowledge of type 1 diabetes or ketoacidosis.",
      culturalOrCommunicationNeeds:
        "None requested. Do not invent ethnicity, religion or cultural identity.",
      actorNotes: [
        "Sound tired but alert, coherent and able to drink normally.",
        "Do not volunteer weight loss until asked about weight, appetite or associated symptoms.",
        "Do not claim a glucose result or diagnosis; he has not been tested.",
      ],
    },
    redFlags: [
      "Rapid progression of marked thirst and polyuria",
      "Seven-kilogram unintentional weight loss",
      "Need to screen actively for vomiting, abdominal pain, rapid breathing, dehydration and altered consciousness",
      "Young age with possible new type 1 diabetes",
    ],
    caseData: {
      schemaVersion: "1.0",
      contentVersion: "endo-new-diabetes-1.0.0",
      contentStatus: "synthetic-educational-draft",
      syntheticNotice,
      expertApprovalStatus: "not-reviewed",
      intendedLearners: "Australian medical students, Years 2–4",
      learningObjectives: [
        "Characterise thirst and urinary frequency as possible osmotic symptoms.",
        "Elicit weight, appetite, fatigue, visual, infective and functional symptoms associated with diabetes.",
        "Screen specifically for diabetic ketoacidosis and clinically significant dehydration.",
        "Explore relevant family, autoimmune, medication and lifestyle context without blame or assumptions.",
      ],
      candidateInstructions: [
        "You are a medical student in a university health general practice clinic. A supervising GP is available.",
        "Take a focused history of the thirst and urinary symptoms. You have 9 minutes.",
        "This station assesses questioning and patient communication only; no clinical summary, differential list or management plan is required.",
        "Verbalise an immediate safety concern if symptoms of acute metabolic deterioration are disclosed. Do not ask the patient for examination or test results.",
      ],
      patientActorRules: commonActorRules,
      clinicalTruth: {
        likelyDiagnosis: "New diabetes mellitus, with type 1 diabetes requiring prompt exclusion",
        timeCriticalDifferentials: [
          "Diabetic ketoacidosis",
          "Hyperosmolar hyperglycaemic state",
          "Severe dehydration",
          "Diabetes insipidus or another cause of true polyuria",
        ],
        currentSafetyContext:
          "Progressive symptoms and weight loss need same-day assessment, but no history features of current ketoacidosis or altered consciousness are disclosed.",
        evaluatorOnlyNote:
          "Credit DKA screening despite the negative answers. Do not label the likely diabetes type as confirmed from history alone.",
      },
      atomicFacts: [
        { id: "dm.pc.01", category: "presenting_complaint", label: "Main symptoms", value: "Constant thirst and frequent urination worsening for about four weeks", disclosureLevel: "opening", triggers: ["what brought you in", "thirst", "urination", "main problem"], assessmentTags: ["chief_complaint", "osmotic_symptoms"], importance: "critical" },
        { id: "dm.hpi.01", category: "presenting_complaint", label: "Onset and trajectory", value: "Gradual onset four weeks ago, noticeably worse over the last seven days", disclosureLevel: "broad_question", triggers: ["when", "onset", "getting worse", "how long"], assessmentTags: ["timeline", "progression"], importance: "critical" },
        { id: "dm.hpi.02", category: "presenting_complaint", label: "Fluid intake", value: "Drinks roughly five to six litres of water daily and still feels thirsty; not deliberately forcing fluids", disclosureLevel: "direct_question", triggers: ["how much drink", "litres", "still thirsty", "forcing fluids"], assessmentTags: ["polydipsia", "severity"], importance: "core" },
        { id: "dm.hpi.03", category: "presenting_complaint", label: "Urinary volume and frequency", value: "Passes a large amount of pale urine every one to two hours, rather than just small frequent amounts", disclosureLevel: "specific_question", triggers: ["how often", "how much urine", "large volume", "small amount", "colour"], assessmentTags: ["polyuria"], importance: "critical" },
        { id: "dm.hpi.04", category: "functional_impact", label: "Nocturia and sleep", value: "Gets up three or four times each night to urinate and feels exhausted in morning lectures", disclosureLevel: "direct_question", triggers: ["night", "nocturia", "sleep", "impact"], assessmentTags: ["polyuria", "functional_impact"], importance: "core" },
        { id: "dm.assoc.01", category: "associated_symptoms", label: "Weight and appetite", value: "Lost about seven kilograms unintentionally in one month despite feeling hungrier and eating more", disclosureLevel: "direct_question", triggers: ["weight", "lost weight", "appetite", "hungry", "eating"], assessmentTags: ["catabolic_symptoms"], importance: "critical" },
        { id: "dm.assoc.02", category: "associated_symptoms", label: "Fatigue and concentration", value: "Increasingly tired with difficulty concentrating at university and work", disclosureLevel: "direct_question", triggers: ["tired", "fatigue", "concentration", "energy"], assessmentTags: ["hyperglycaemia_symptoms", "functional_impact"], importance: "core" },
        { id: "dm.assoc.03", category: "associated_symptoms", label: "Vision", value: "Intermittent blurred distance vision for one week, affecting both eyes, without eye pain or vision loss", disclosureLevel: "direct_question", triggers: ["vision", "blurred", "eyes"], assessmentTags: ["hyperglycaemia_symptoms"], importance: "core" },
        { id: "dm.assoc.04", category: "associated_symptoms", label: "Infection and healing", value: "Had an itchy groin rash treated as thrush two weeks ago; no slow-healing wound, fever or current infection", disclosureLevel: "specific_question", triggers: ["infection", "thrush", "rash", "wound", "healing", "fever"], assessmentTags: ["hyperglycaemia_symptoms"], importance: "core" },
        { id: "dm.rf.01", category: "red_flag", label: "Gastrointestinal DKA symptoms", value: "No nausea, vomiting or abdominal pain", disclosureLevel: "specific_question", triggers: ["nausea", "vomiting", "abdominal pain", "stomach pain"], assessmentTags: ["dka_screen"], importance: "critical" },
        { id: "dm.rf.02", category: "red_flag", label: "Respiratory DKA symptoms", value: "No rapid or deep breathing and no shortness of breath", disclosureLevel: "specific_question", triggers: ["rapid breathing", "deep breathing", "short of breath", "breathing"], assessmentTags: ["dka_screen"], importance: "critical" },
        { id: "dm.rf.03", category: "red_flag", label: "Neurological deterioration", value: "No drowsiness, confusion, fainting or collapse", disclosureLevel: "specific_question", triggers: ["drowsy", "confused", "faint", "collapse"], assessmentTags: ["dka_hhs_screen"], importance: "critical" },
        { id: "dm.rf.04", category: "red_flag", label: "Hydration and oral intake", value: "Mouth feels dry but he can drink normally and has not been unable to keep fluids down", disclosureLevel: "specific_question", triggers: ["dry mouth", "dehydrated", "drink", "keep fluids down"], assessmentTags: ["dehydration_screen"], importance: "critical" },
        { id: "dm.urinary.01", category: "associated_symptoms", label: "Urinary tract symptoms", value: "No pain or burning passing urine, urgency, blood, loin pain or urethral discharge", disclosureLevel: "specific_question", triggers: ["burning", "pain urinating", "urgency", "blood", "loin", "discharge"], assessmentTags: ["urinary_differential"], importance: "core" },
        { id: "dm.pmh.01", category: "past_history", label: "Past medical history", value: "No previous diabetes, kidney disease, head injury, pituitary disease or hospital admission", disclosureLevel: "direct_question", triggers: ["medical history", "diabetes before", "kidney", "head injury", "pituitary", "hospital"], assessmentTags: ["past_history", "polyuria_differential"], importance: "core" },
        { id: "dm.pmh.02", category: "past_history", label: "Autoimmune history", value: "No known thyroid, coeliac or other autoimmune disease", disclosureLevel: "specific_question", triggers: ["thyroid", "coeliac", "autoimmune"], assessmentTags: ["type1_context"], importance: "context" },
        { id: "dm.med.01", category: "medication", label: "Medicine causes", value: "Takes no regular medicines and has not used glucocorticoids, diuretics, lithium or antipsychotic medicines", disclosureLevel: "specific_question", triggers: ["medications", "steroids", "prednisone", "diuretic", "water tablet", "lithium", "antipsychotic"], assessmentTags: ["secondary_diabetes_polyuria"], importance: "core" },
        { id: "dm.allergy.01", category: "allergy", label: "Allergies", value: "No known medication allergies", disclosureLevel: "direct_question", triggers: ["allergies", "reaction"], assessmentTags: ["allergy_history"], importance: "context" },
        { id: "dm.fh.01", category: "family_history", label: "Diabetes family history", value: "His mother developed type 2 diabetes at 50; no known type 1 diabetes in the family", disclosureLevel: "direct_question", triggers: ["family history", "diabetes in family", "parents"], assessmentTags: ["diabetes_risk"], importance: "core" },
        { id: "dm.fh.02", category: "family_history", label: "Autoimmune family history", value: "His older sister has coeliac disease", disclosureLevel: "specific_question", triggers: ["autoimmune in family", "coeliac", "thyroid"], assessmentTags: ["autoimmune_context"], importance: "context" },
        { id: "dm.sh.01", category: "social_history", label: "Diet and sugary drinks", value: "Usually eats mixed home and takeaway food; switched from soft drink to water after the thirst began but symptoms continued", disclosureLevel: "direct_question", triggers: ["diet", "soft drink", "sugary drink", "food"], assessmentTags: ["lifestyle_context"], importance: "context" },
        { id: "dm.sh.02", category: "social_history", label: "Alcohol, smoking and drugs", value: "Drinks two or three beers on weekends, does not smoke or vape and uses no recreational drugs", disclosureLevel: "direct_question", triggers: ["alcohol", "smoke", "vape", "drugs"], assessmentTags: ["social_history"], importance: "context" },
        { id: "dm.sh.03", category: "social_history", label: "Home and safety", value: "Lives with two supportive housemates and walked to the clinic; has not driven while blurred or faint", disclosureLevel: "specific_question", triggers: ["live with", "support", "drove", "safety", "home"], assessmentTags: ["support", "immediate_safety"], importance: "context" },
        { id: "dm.ice.01", category: "patient_perspective", label: "Ideas and concern", value: "He assumed heat and study stress caused it, but his mother is worried he has diabetes; he fears lifelong injections", disclosureLevel: "direct_question", triggers: ["what do you think", "worried", "concern", "diabetes"], assessmentTags: ["ice", "empathy"], importance: "core" },
        { id: "dm.ice.02", category: "patient_perspective", label: "Expectation", value: "He wants a test and an explanation for the symptoms, and wants to know whether he can still attend an exam tomorrow", disclosureLevel: "direct_question", triggers: ["hoping", "expect", "how can we help", "exam"], assessmentTags: ["ice", "functional_impact"], importance: "context" },
      ],
      unknownPolicy: commonUnknownPolicy,
      redFlags: [
        { id: "dm.rf.dka", label: "Diabetic ketoacidosis symptoms", clinicalConcern: "Acute metabolic decompensation", requiredQuestions: ["nausea or vomiting", "abdominal pain", "rapid or deep breathing", "drowsiness or confusion", "ability to drink"], linkedFactIds: ["dm.rf.01", "dm.rf.02", "dm.rf.03", "dm.rf.04"], critical: true },
        { id: "dm.rf.catabolic", label: "Rapid catabolic presentation", clinicalConcern: "Possible insulin deficiency and near-term deterioration", requiredQuestions: ["symptom trajectory", "unintentional weight loss", "appetite", "fatigue"], linkedFactIds: ["dm.hpi.01", "dm.assoc.01", "dm.assoc.02"], critical: true },
        { id: "dm.rf.polyuria", label: "True polyuria versus urinary frequency", clinicalConcern: "Diabetes mellitus, diabetes insipidus or a urinary tract process", requiredQuestions: ["urine volume", "frequency and nocturia", "fluid intake", "dysuria or urgency", "medicine causes"], linkedFactIds: ["dm.hpi.02", "dm.hpi.03", "dm.hpi.04", "dm.urinary.01", "dm.med.01"], critical: false },
      ],
      criticalItems: [
        { id: "dm.critical.dka", label: "Screens for ketoacidosis", expectedBehaviour: "Asks directly about vomiting, abdominal pain, abnormal breathing, altered consciousness and inability to drink.", linkedFactIds: ["dm.rf.01", "dm.rf.02", "dm.rf.03", "dm.rf.04"], consequenceIfMissed: "Red-flags domain cannot score above 1/3." },
        { id: "dm.critical.weight", label: "Identifies catabolic weight loss", expectedBehaviour: "Asks about unintentional weight change and quantifies amount and time course.", linkedFactIds: ["dm.assoc.01"], consequenceIfMissed: "Major HPI omission and reduced recognition of possible insulin deficiency." },
      ],
      patientPerspective: {
        ideas: "He initially blamed hot weather and study stress; his mother suggested diabetes.",
        concerns: "He worries that diabetes would mean injections forever and disrupt university.",
        expectations: "A test, a plain-language explanation and advice about his exam tomorrow.",
        impact: "Nocturia disrupts sleep, fatigue affects lectures and café shifts, and blurred vision makes studying harder.",
      },
      teachingPoints: [
        "Distinguish true large-volume polyuria from frequent small-volume urination.",
        "In a young person with thirst, polyuria and weight loss, ask proactively about ketoacidosis even if the patient appears conversationally well.",
        "A history can raise concern for diabetes but laboratory testing is required for diagnosis.",
        "Explore medicines, autoimmune context and lifestyle without blaming the patient or presuming diabetes type.",
      ],
      sourceBasis: [
        { label: "Diabetes Australia — common symptoms and diagnosis", url: "https://www.diabetesaustralia.com.au/about-diabetes/what-is-diabetes/" },
      ],
    },
  },
];

const domainBlueprint: Array<{
  id: RubricDomainId;
  label: string;
  description: string;
  weight: number;
}> = [
  {
    id: "opening_communication",
    label: "Opening and professional communication",
    description:
      "Introduces role, confirms the patient, obtains consent, uses understandable language and establishes a respectful, patient-centred interaction.",
    weight: 10,
  },
  {
    id: "history_presenting_illness",
    label: "History of the presenting illness",
    description:
      "Uses an open start followed by a focused chronology and relevant symptom analysis, with clarification and appropriate signposting.",
    weight: 25,
  },
  {
    id: "red_flags_patient_safety",
    label: "Red flags and patient safety",
    description:
      "Elicits case-specific time-critical features, assesses current severity and communicates urgency when indicated.",
    weight: 20,
  },
  {
    id: "background_history",
    label: "Relevant background history",
    description:
      "Obtains focused medical, medication, allergy and family history relevant to the presentation.",
    weight: 15,
  },
  {
    id: "psychosocial_context",
    label: "Psychosocial, occupational and lifestyle context",
    description:
      "Explores function, supports and relevant lifestyle or exposure factors without judgment or unsupported assumptions.",
    weight: 10,
  },
  {
    id: "patient_perspective_cultural_safety",
    label: "Patient perspective and culturally safe communication",
    description:
      "Explores ideas, concerns, expectations and impact; responds empathically and adapts to expressed preferences without stereotyping.",
    weight: 10,
  },
  {
    id: "closure",
    label: "Closure",
    description:
      "Checks for unanswered concerns, explains the immediate next step in plain language and closes safely without false reassurance.",
    weight: 10,
  },
];

type RubricCaseSpec = Record<
  RubricDomainId,
  {
    items: RubricItem[];
    redFlagIds?: string[];
    critical?: boolean;
  }
>;

function buildRubric(
  slug: string,
  name: string,
  caseFocus: string,
  specification: RubricCaseSpec,
): SeedRubric {
  return {
    slug,
    name,
    description:
      `Formative seven-domain history-taking rubric for ${caseFocus}. ` +
      "This synthetic educator-review draft is not a validated high-stakes assessment instrument.",
    frameworkVersion: "history-7-domain-v1",
    scoreScale: { min: 0, max: 3 },
    criteria: domainBlueprint.map((domain) => {
      const caseDomain = specification[domain.id];
      const expected = caseDomain.items.map((item) => item.behaviour).join("; ");

      return {
        id: domain.id,
        label: domain.label,
        description: domain.description,
        weight: domain.weight,
        maxScore: 3,
        critical: caseDomain.critical ?? false,
        redFlagIds: caseDomain.redFlagIds ?? [],
        anchors: {
          0: "Not demonstrated, seriously unsafe, or contradicted by the transcript. Do not infer credit from facts volunteered by the patient.",
          1: `Partially demonstrated but disorganised or incomplete, with major omissions. Expected behaviours include: ${expected}`,
          2: "Mostly demonstrated with a logical, respectful approach; covers most core behaviours but has one important omission or several minor omissions.",
          3: "Demonstrated comprehensively, accurately and efficiently; all critical behaviours and nearly all relevant case-specific behaviours are explicit in the transcript.",
        },
        caseSpecificItems: caseDomain.items,
        evidencePolicy:
          "Award credit only for explicit learner questions or statements supported by transcript turn IDs. A relevant negative answer earns credit when the learner elicited it. Do not treat an unasked fact volunteered by the patient as evidence of the learner's questioning. Do not award credit from the evaluator's clinical inference alone.",
      };
    }),
  };
}

export const seedRubrics: SeedRubric[] = [
  buildRubric(
    "pressure-in-my-chest",
    "Acute chest discomfort history rubric",
    "acute chest discomfort with possible ACS",
    {
      opening_communication: {
        items: [
          { id: "chest.rubric.open.01", behaviour: "Introduces self and student role, confirms the patient's preferred name and obtains consent to ask questions.", linkedFactIds: [] },
          { id: "chest.rubric.open.02", behaviour: "Acknowledges visible discomfort and begins with an open but time-conscious invitation.", linkedFactIds: ["chest.pc.01"] },
        ],
      },
      history_presenting_illness: {
        items: [
          { id: "chest.rubric.hpi.01", behaviour: "Establishes exact onset, activity at onset, continuous duration and whether symptoms are current.", linkedFactIds: ["chest.hpi.01", "chest.hpi.02"], critical: true },
          { id: "chest.rubric.hpi.02", behaviour: "Characterises site, pressure quality, severity and radiation.", linkedFactIds: ["chest.pc.01", "chest.hpi.03", "chest.hpi.04", "chest.hpi.05"] },
          { id: "chest.rubric.hpi.03", behaviour: "Elicits previous exertional episodes and their response to rest.", linkedFactIds: ["chest.hpi.06"], critical: true },
          { id: "chest.rubric.hpi.04", behaviour: "Asks about breathlessness, nausea, vomiting and diaphoresis.", linkedFactIds: ["chest.assoc.01", "chest.assoc.02"], critical: true },
        ],
      },
      red_flags_patient_safety: {
        critical: true,
        redFlagIds: ["chest.rf.ongoing", "chest.rf.associated", "chest.rf.alternatives"],
        items: [
          { id: "chest.rubric.safe.01", behaviour: "Recognises and promptly verbalises concern about ongoing ischaemic-pattern symptoms to the supervising team.", linkedFactIds: ["chest.hpi.01", "chest.hpi.02", "chest.assoc.01", "chest.assoc.02"], critical: true },
          { id: "chest.rubric.safe.02", behaviour: "Screens for syncope, palpitations or haemodynamic symptoms.", linkedFactIds: ["chest.assoc.03"] },
          { id: "chest.rubric.safe.03", behaviour: "Screens for pleuritic, tearing/back-pain and thromboembolic features without delaying escalation.", linkedFactIds: ["chest.diff.01", "chest.diff.02", "chest.diff.03"] },
        ],
      },
      background_history: {
        items: [
          { id: "chest.rubric.bg.01", behaviour: "Asks about hypertension, dyslipidaemia, diabetes and previous cardiovascular disease.", linkedFactIds: ["chest.pmh.01", "chest.pmh.02"] },
          { id: "chest.rubric.bg.02", behaviour: "Obtains regular medicines, adherence, antithrombotic use and allergies with reaction.", linkedFactIds: ["chest.med.01", "chest.med.02", "chest.allergy.01"] },
          { id: "chest.rubric.bg.03", behaviour: "Elicits premature cardiovascular disease in the family.", linkedFactIds: ["chest.fh.01"] },
        ],
      },
      psychosocial_context: {
        items: [
          { id: "chest.rubric.social.01", behaviour: "Quantifies tobacco exposure and asks neutrally about alcohol and stimulant drug use.", linkedFactIds: ["chest.sh.01", "chest.sh.02"] },
          { id: "chest.rubric.social.02", behaviour: "Checks immediate support and safe arrival context.", linkedFactIds: ["chest.sh.03"] },
        ],
      },
      patient_perspective_cultural_safety: {
        items: [
          { id: "chest.rubric.ice.01", behaviour: "Asks what the patient thinks may be happening and what concerns her most.", linkedFactIds: ["chest.ice.01"] },
          { id: "chest.rubric.ice.02", behaviour: "Acknowledges fear without false reassurance and asks what she needs from the team.", linkedFactIds: ["chest.ice.01", "chest.ice.02"] },
          { id: "chest.rubric.ice.03", behaviour: "Uses inclusive, non-assumptive language about partner and support.", linkedFactIds: ["chest.sh.03"] },
        ],
      },
      closure: {
        critical: true,
        items: [
          { id: "chest.rubric.close.01", behaviour: "Explains that the symptoms need immediate clinical team assessment and does not offer a diagnosis or reassurance.", linkedFactIds: ["chest.pc.01", "chest.hpi.02"], critical: true },
          { id: "chest.rubric.close.02", behaviour: "Checks for an urgent unanswered concern while avoiding a prolonged routine close.", linkedFactIds: ["chest.ice.02"] },
        ],
      },
    },
  ),
  buildRubric(
    "cant-catch-my-breath",
    "Acute breathlessness history rubric",
    "worsening breathlessness in a patient with COPD",
    {
      opening_communication: {
        items: [
          { id: "breath.rubric.open.01", behaviour: "Introduces self and role, confirms preferred name and obtains consent.", linkedFactIds: [] },
          { id: "breath.rubric.open.02", behaviour: "Adapts pace and question length to breathlessness and avoids interrupting unnecessarily.", linkedFactIds: ["breath.hpi.03"] },
        ],
      },
      history_presenting_illness: {
        items: [
          { id: "breath.rubric.hpi.01", behaviour: "Establishes gradual onset, three-day trajectory and current change from baseline.", linkedFactIds: ["breath.hpi.01", "breath.hpi.02", "breath.hpi.03"], critical: true },
          { id: "breath.rubric.hpi.02", behaviour: "Quantifies functional limitation using concrete walking and daily-activity examples.", linkedFactIds: ["breath.hpi.02"] },
          { id: "breath.rubric.hpi.03", behaviour: "Characterises cough, sputum amount and colour, fever and sick contacts.", linkedFactIds: ["breath.assoc.01", "breath.assoc.02", "breath.assoc.03"] },
          { id: "breath.rubric.hpi.04", behaviour: "Asks about wheeze and chest tightness.", linkedFactIds: ["breath.assoc.04"] },
        ],
      },
      red_flags_patient_safety: {
        critical: true,
        redFlagIds: ["breath.rf.severity", "breath.rf.alternatives", "breath.rf.exacerbation"],
        items: [
          { id: "breath.rubric.safe.01", behaviour: "Screens for inability to talk or walk, cyanosis, drowsiness, confusion and collapse.", linkedFactIds: ["breath.hpi.03", "breath.rf.01"], critical: true },
          { id: "breath.rubric.safe.02", behaviour: "Screens for chest pain, syncope and haemoptysis.", linkedFactIds: ["breath.rf.02", "breath.rf.03"], critical: true },
          { id: "breath.rubric.safe.03", behaviour: "Checks sudden onset, DVT/PE risks and heart failure symptoms rather than anchoring on COPD.", linkedFactIds: ["breath.hpi.01", "breath.rf.04", "breath.rf.05"] },
          { id: "breath.rubric.safe.04", behaviour: "Verbalises urgency if severe deterioration features emerge.", linkedFactIds: ["breath.hpi.02", "breath.hpi.03", "breath.med.02"], critical: true },
        ],
      },
      background_history: {
        items: [
          { id: "breath.rubric.bg.01", behaviour: "Clarifies COPD diagnosis, baseline status, previous admissions, ICU/ventilation and home oxygen.", linkedFactIds: ["breath.pmh.01", "breath.pmh.02"] },
          { id: "breath.rubric.bg.02", behaviour: "Elicits relevant cardiopulmonary comorbidities and prior clots.", linkedFactIds: ["breath.pmh.03"] },
          { id: "breath.rubric.bg.03", behaviour: "Obtains maintenance inhalers, adherence and precise reliever frequency and effect.", linkedFactIds: ["breath.med.01", "breath.med.02", "breath.med.03"], critical: true },
          { id: "breath.rubric.bg.04", behaviour: "Checks medication allergies.", linkedFactIds: ["breath.allergy.01"] },
        ],
      },
      psychosocial_context: {
        items: [
          { id: "breath.rubric.social.01", behaviour: "Quantifies lifetime smoking and current smoking or vaping status without judgment.", linkedFactIds: ["breath.sh.01"] },
          { id: "breath.rubric.social.02", behaviour: "Explores baseline independence, current care needs and home support.", linkedFactIds: ["breath.sh.02", "breath.hpi.02"] },
          { id: "breath.rubric.social.03", behaviour: "Asks about relevant vaccination status.", linkedFactIds: ["breath.sh.03"] },
        ],
      },
      patient_perspective_cultural_safety: {
        items: [
          { id: "breath.rubric.ice.01", behaviour: "Explores the patient's explanation, fear about treatment failure and concern about admission.", linkedFactIds: ["breath.ice.01", "breath.ice.02"] },
          { id: "breath.rubric.ice.02", behaviour: "Acknowledges distress and checks communication preferences rather than inferring needs from identity.", linkedFactIds: [] },
        ],
      },
      closure: {
        items: [
          { id: "breath.rubric.close.01", behaviour: "Checks for further urgent concerns and explains that the supervisor/team will assess the worsening breathing promptly.", linkedFactIds: ["breath.ice.02", "breath.hpi.03"] },
          { id: "breath.rubric.close.02", behaviour: "Avoids promising discharge or giving false reassurance based on negative symptoms.", linkedFactIds: ["breath.ice.02"] },
        ],
      },
    },
  ),
  buildRubric(
    "burning-pain-after-meals",
    "Epigastric pain and possible GI bleed history rubric",
    "epigastric pain with NSAID exposure and suspected upper GI bleeding",
    {
      opening_communication: {
        items: [
          { id: "epi.rubric.open.01", behaviour: "Introduces self and role, confirms preferred name and obtains consent.", linkedFactIds: [] },
          { id: "epi.rubric.open.02", behaviour: "Uses an open invitation before asking focused abdominal and bleeding questions.", linkedFactIds: ["epi.pc.01"] },
        ],
      },
      history_presenting_illness: {
        items: [
          { id: "epi.rubric.hpi.01", behaviour: "Elicits onset, progression, site, character, severity and episode duration.", linkedFactIds: ["epi.hpi.01", "epi.hpi.02", "epi.hpi.03", "epi.hpi.04"] },
          { id: "epi.rubric.hpi.02", behaviour: "Explores meal and nocturnal relationship, radiation, relieving factors and vomiting.", linkedFactIds: ["epi.hpi.04", "epi.hpi.05", "epi.hpi.06", "epi.assoc.01"] },
          { id: "epi.rubric.hpi.03", behaviour: "Asks about dysphagia, weight loss and persistent vomiting.", linkedFactIds: ["epi.rf.05"] },
          { id: "epi.rubric.hpi.04", behaviour: "Screens for relevant hepatobiliary and pancreatic symptoms.", linkedFactIds: ["epi.assoc.02"] },
        ],
      },
      red_flags_patient_safety: {
        critical: true,
        redFlagIds: ["epi.rf.bleeding", "epi.rf.instability", "epi.rf.exposure", "epi.rf.perforation"],
        items: [
          { id: "epi.rubric.safe.01", behaviour: "Asks explicitly and neutrally about black/tarry stool and blood or coffee-ground vomit.", linkedFactIds: ["epi.rf.01", "epi.rf.02"], critical: true },
          { id: "epi.rubric.safe.02", behaviour: "Assesses postural light-headedness, syncope, collapse, breathlessness and chest symptoms.", linkedFactIds: ["epi.rf.03"], critical: true },
          { id: "epi.rubric.safe.03", behaviour: "Screens for sudden severe or generalised pain suggesting perforation.", linkedFactIds: ["epi.rf.04"] },
          { id: "epi.rubric.safe.04", behaviour: "Recognises black stool plus light-headedness as urgent and alerts the supervisor.", linkedFactIds: ["epi.rf.01", "epi.rf.03"], critical: true },
        ],
      },
      background_history: {
        critical: true,
        items: [
          { id: "epi.rubric.bg.01", behaviour: "Clarifies previous reflux, ulcer, bleeding, liver disease and endoscopy history.", linkedFactIds: ["epi.pmh.01"] },
          { id: "epi.rubric.bg.02", behaviour: "Specifically elicits over-the-counter NSAID drug, dose, frequency and duration.", linkedFactIds: ["epi.med.01"], critical: true },
          { id: "epi.rubric.bg.03", behaviour: "Checks aspirin, antiplatelets, anticoagulants and steroids.", linkedFactIds: ["epi.med.02"], critical: true },
          { id: "epi.rubric.bg.04", behaviour: "Obtains other medicines, allergies and relevant family history.", linkedFactIds: ["epi.med.03", "epi.allergy.01", "epi.fh.01"] },
        ],
      },
      psychosocial_context: {
        items: [
          { id: "epi.rubric.social.01", behaviour: "Quantifies alcohol and asks neutrally about smoking and other substances.", linkedFactIds: ["epi.sh.01", "epi.sh.02"] },
          { id: "epi.rubric.social.02", behaviour: "Explores work impact, driving safety and available support.", linkedFactIds: ["epi.sh.03"] },
        ],
      },
      patient_perspective_cultural_safety: {
        items: [
          { id: "epi.rubric.ice.01", behaviour: "Explores cancer and bleeding concerns, responds empathically and avoids premature reassurance.", linkedFactIds: ["epi.ice.01"] },
          { id: "epi.rubric.ice.02", behaviour: "Asks what explanation or help the patient is seeking.", linkedFactIds: ["epi.ice.02"] },
          { id: "epi.rubric.ice.03", behaviour: "Uses plain, non-shaming language for bowel and alcohol questions.", linkedFactIds: ["epi.rf.01", "epi.sh.01"] },
        ],
      },
      closure: {
        critical: true,
        items: [
          { id: "epi.rubric.close.01", behaviour: "Explains that possible bleeding symptoms need immediate senior assessment and avoids a definitive diagnosis.", linkedFactIds: ["epi.rf.01", "epi.rf.03"], critical: true },
          { id: "epi.rubric.close.02", behaviour: "Checks for a remaining urgent concern and ensures the patient is not encouraged to drive away.", linkedFactIds: ["epi.sh.03", "epi.ice.02"] },
        ],
      },
    },
  ),
  buildRubric(
    "worst-headache",
    "Thunderclap headache history rubric",
    "a first sudden severe headache",
    {
      opening_communication: {
        items: [
          { id: "head.rubric.open.01", behaviour: "Introduces self and role, confirms preferred name and obtains consent.", linkedFactIds: [] },
          { id: "head.rubric.open.02", behaviour: "Acknowledges severe pain and adapts to brief, low-stimulation questioning.", linkedFactIds: ["head.hpi.04", "head.assoc.01"] },
        ],
      },
      history_presenting_illness: {
        critical: true,
        items: [
          { id: "head.rubric.hpi.01", behaviour: "Establishes exact onset time, activity at onset and time from onset to maximum intensity.", linkedFactIds: ["head.hpi.01", "head.hpi.02"], critical: true },
          { id: "head.rubric.hpi.02", behaviour: "Characterises site, spread, quality, severity and current course.", linkedFactIds: ["head.hpi.03", "head.hpi.04", "head.hpi.05"] },
          { id: "head.rubric.hpi.03", behaviour: "Asks about vomiting, photophobia and neck stiffness.", linkedFactIds: ["head.assoc.01", "head.assoc.02"], critical: true },
          { id: "head.rubric.hpi.04", behaviour: "Compares explicitly with previous headaches or migraine pattern.", linkedFactIds: ["head.pmh.01"], critical: true },
        ],
      },
      red_flags_patient_safety: {
        critical: true,
        redFlagIds: ["head.rf.thunderclap", "head.rf.neurological", "head.rf.meningism", "head.rf.context"],
        items: [
          { id: "head.rubric.safe.01", behaviour: "Recognises a thunderclap headache and immediately alerts the supervisor rather than completing a routine history first.", linkedFactIds: ["head.pc.01", "head.hpi.02"], critical: true },
          { id: "head.rubric.safe.02", behaviour: "Screens for focal neurological symptoms, altered consciousness and seizure.", linkedFactIds: ["head.rf.01", "head.rf.02"], critical: true },
          { id: "head.rubric.safe.03", behaviour: "Screens for fever, rash and meningism.", linkedFactIds: ["head.assoc.02", "head.rf.03"], critical: true },
          { id: "head.rubric.safe.04", behaviour: "Checks trauma or neck manipulation, pregnancy/postpartum status and relevant medicines or stimulant substances.", linkedFactIds: ["head.rf.04", "head.rf.05", "head.med.01", "head.sh.01"] },
        ],
      },
      background_history: {
        items: [
          { id: "head.rubric.bg.01", behaviour: "Obtains previous headache pattern and relevant vascular, cancer, clotting, renal or connective-tissue history.", linkedFactIds: ["head.pmh.01", "head.pmh.02"] },
          { id: "head.rubric.bg.02", behaviour: "Checks anticoagulants, antiplatelets and hormonal medicines.", linkedFactIds: ["head.med.01"] },
          { id: "head.rubric.bg.03", behaviour: "Asks about attempted analgesia, allergies and family aneurysm history.", linkedFactIds: ["head.med.02", "head.allergy.01", "head.fh.01"] },
        ],
      },
      psychosocial_context: {
        items: [
          { id: "head.rubric.social.01", behaviour: "Asks non-judgmentally about smoking, stimulants and performance-enhancing substances.", linkedFactIds: ["head.sh.01"] },
          { id: "head.rubric.social.02", behaviour: "Checks that support people know the patient is in hospital.", linkedFactIds: ["head.sh.02"] },
        ],
      },
      patient_perspective_cultural_safety: {
        items: [
          { id: "head.rubric.ice.01", behaviour: "Explores and validates fear about aneurysm without confirming or dismissing it.", linkedFactIds: ["head.ice.01", "head.fh.01"] },
          { id: "head.rubric.ice.02", behaviour: "Asks what help the patient wants and respects the preference for brief questions and reduced light.", linkedFactIds: ["head.ice.02", "head.assoc.01"] },
        ],
      },
      closure: {
        critical: true,
        items: [
          { id: "head.rubric.close.01", behaviour: "States that a sudden severe headache requires urgent senior assessment and does not label it as migraine.", linkedFactIds: ["head.hpi.02", "head.pmh.01"], critical: true },
          { id: "head.rubric.close.02", behaviour: "Checks for an immediate unanswered concern while keeping closure brief.", linkedFactIds: ["head.ice.02"] },
        ],
      },
    },
  ),
  buildRubric(
    "always-thirsty",
    "Polyuria and polydipsia history rubric",
    "progressive osmotic symptoms and possible new diabetes",
    {
      opening_communication: {
        items: [
          { id: "dm.rubric.open.01", behaviour: "Introduces self and role, confirms preferred name and obtains consent.", linkedFactIds: [] },
          { id: "dm.rubric.open.02", behaviour: "Begins with an open invitation and avoids blaming language about weight, diet or diabetes.", linkedFactIds: ["dm.pc.01"] },
        ],
      },
      history_presenting_illness: {
        items: [
          { id: "dm.rubric.hpi.01", behaviour: "Establishes onset and progression of thirst and urination.", linkedFactIds: ["dm.hpi.01"] },
          { id: "dm.rubric.hpi.02", behaviour: "Quantifies fluid intake, urinary frequency, true urine volume and nocturia.", linkedFactIds: ["dm.hpi.02", "dm.hpi.03", "dm.hpi.04"], critical: true },
          { id: "dm.rubric.hpi.03", behaviour: "Elicits and quantifies unintentional weight loss, appetite change, fatigue and functional impact.", linkedFactIds: ["dm.assoc.01", "dm.assoc.02"], critical: true },
          { id: "dm.rubric.hpi.04", behaviour: "Asks about blurred vision, infection or thrush and urinary tract symptoms.", linkedFactIds: ["dm.assoc.03", "dm.assoc.04", "dm.urinary.01"] },
        ],
      },
      red_flags_patient_safety: {
        critical: true,
        redFlagIds: ["dm.rf.dka", "dm.rf.catabolic", "dm.rf.polyuria"],
        items: [
          { id: "dm.rubric.safe.01", behaviour: "Screens explicitly for nausea, vomiting and abdominal pain.", linkedFactIds: ["dm.rf.01"], critical: true },
          { id: "dm.rubric.safe.02", behaviour: "Screens for rapid/deep breathing, drowsiness, confusion, collapse and inability to keep fluids down.", linkedFactIds: ["dm.rf.02", "dm.rf.03", "dm.rf.04"], critical: true },
          { id: "dm.rubric.safe.03", behaviour: "Recognises rapid weight loss and progression as requiring prompt clinical assessment, without claiming a confirmed diagnosis.", linkedFactIds: ["dm.hpi.01", "dm.assoc.01"], critical: true },
        ],
      },
      background_history: {
        items: [
          { id: "dm.rubric.bg.01", behaviour: "Asks about previous diabetes, renal, pituitary and autoimmune conditions.", linkedFactIds: ["dm.pmh.01", "dm.pmh.02"] },
          { id: "dm.rubric.bg.02", behaviour: "Checks medicines that can contribute to hyperglycaemia or polyuria, including steroids, diuretics, lithium and antipsychotics.", linkedFactIds: ["dm.med.01"] },
          { id: "dm.rubric.bg.03", behaviour: "Obtains allergy and family diabetes or autoimmune history.", linkedFactIds: ["dm.allergy.01", "dm.fh.01", "dm.fh.02"] },
        ],
      },
      psychosocial_context: {
        items: [
          { id: "dm.rubric.social.01", behaviour: "Explores impact on sleep, study and work with concrete examples.", linkedFactIds: ["dm.hpi.04", "dm.assoc.02", "dm.ice.02"] },
          { id: "dm.rubric.social.02", behaviour: "Asks neutrally about diet, sugary drinks, alcohol, smoking and other substances.", linkedFactIds: ["dm.sh.01", "dm.sh.02"] },
          { id: "dm.rubric.social.03", behaviour: "Checks home support and immediate safety, including driving with visual or faint symptoms.", linkedFactIds: ["dm.sh.03"] },
        ],
      },
      patient_perspective_cultural_safety: {
        items: [
          { id: "dm.rubric.ice.01", behaviour: "Explores the patient's explanation and fear of injections without assuming diabetes type or assigning blame.", linkedFactIds: ["dm.ice.01"] },
          { id: "dm.rubric.ice.02", behaviour: "Asks about expectations and the practical concern regarding the exam.", linkedFactIds: ["dm.ice.02"] },
          { id: "dm.rubric.ice.03", behaviour: "Uses plain language and checks understanding of unfamiliar terms.", linkedFactIds: [] },
        ],
      },
      closure: {
        items: [
          { id: "dm.rubric.close.01", behaviour: "Explains that the symptoms need prompt clinical testing and avoids confirming diabetes from history alone.", linkedFactIds: ["dm.pc.01", "dm.assoc.01"] },
          { id: "dm.rubric.close.02", behaviour: "Checks for remaining concerns and avoids making promises about exam attendance or treatment.", linkedFactIds: ["dm.ice.01", "dm.ice.02"] },
        ],
      },
    },
  ),
];
