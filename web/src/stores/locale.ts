import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

export type Locale = 'en' | 'zh'

const STORAGE_KEY = 'simclin-locale'

const zh: Record<string, string> = {
  Settings: '设置',
  English: 'English',
  '中文': '中文',
  'Student learning': '学生学习',
  Overview: '概览',
  'Case library': '病例库',
  Dashboard: '仪表盘',
  Rubrics: '评分表',
  Results: '成绩结果',
  Insights: '教学洞察',
  'Year 3 Medicine': '医学三年级',
  'Clinical educator': '临床教师',
  'Switch role': '切换角色',
  'Formative learning environment': '形成性学习环境',
  'AI standardised patient training': 'AI 标准化患者训练',
  'Build clinical confidence,': '建立临床信心，',
  'one conversation at a time.': '从一次对话开始。',
  'Practise patient-centred history taking in realistic Australian clinical scenarios, then receive clear, evidence-based formative feedback.': '在真实的澳洲临床场景中练习以患者为中心的病史采集，并获得清晰、有证据支持的形成性反馈。',
  'Safe, synthetic cases': '安全的合成病例',
  'Responsive AI patients': '可互动的 AI 患者',
  'Educator-led rubrics': '教师引导的评分表',
  'Choose your workspace': '选择工作区',
  'No sign-in required for this preview': '此预览无需登录',
  'Preparing your workspace…': '正在准备工作区……',
  'This preview uses built-in demonstration identities.': '此预览使用内置演示身份。',
  'curated medical cases': '精选医学病例',
  'history-taking domains': '病史采集评价域',
  'evidence-linked feedback': '基于证据的反馈',
  'Designed for Australian undergraduate medical education': '为澳洲本科医学教育设计',
  'SimClin AU 1.0 Preview · Not for clinical care': 'SimClin AU 1.0 预览版 · 不用于临床诊疗',
  'Enter as Student': '以学生身份进入',
  'Practise cases and review your feedback': '练习病例并查看反馈',
  'Enter as Faculty': '以教师身份进入',
  'Manage cases, rubrics and results': '管理病例、评分表和成绩',
  'Student workspace': '学生工作区',
  'Faculty workspace': '教师工作区',
  'Practice catalogue': '练习病例目录',
  'Your learning record': '你的学习记录',
  'Review previous consultations and return to evidence-linked feedback.': '查看之前的问诊，并返回查看有证据关联的反馈。',
  'All attempts': '全部练习',
  'No practice attempts yet': '还没有练习记录',
  'Choose a case to start your first consultation.': '选择一个病例开始第一次问诊。',
  'Assessment design': '评分设计',
  'Learning analytics': '学习分析',
  'Assessment review': '评价复核',
  'Clinical content': '临床内容',
  'Educator preview': '教师预览',
  'Attempt review': '练习复核',
  'Case management': '病例管理',
  'Rubric editor': '评分表编辑器',
  'Teaching insights': '教学洞察',
  'Student results': '学生成绩',
  'Good morning': '早上好',
  'Good afternoon': '下午好',
  'Choose a case, meet your patient and practise gathering a clear, safe clinical history.': '选择一个病例，与患者交流，并练习采集清晰、安全的临床病史。',
  'Loading your learning space…': '正在加载你的学习空间……',
  'Explore cases': '浏览病例',
  'Recommended next': '推荐下一步',
  'View all cases': '查看全部病例',
  'Available cases': '可用病例',
  'Across core medicine': '覆盖核心内科',
  'Practice attempts': '练习次数',
  'Latest score': '最近成绩',
  'Formative, out of 100': '形成性评分，满分 100',
  'Practice time': '练习时长',
  'Total consultation time': '问诊总时长',
  'No cases are published yet': '还没有已发布病例',
  "Your educator's published cases will appear here.": '教师发布的病例会显示在这里。',
  'Five structured medical histories, designed for Australian undergraduate clinical learning.': '五个结构化病史病例，面向澳洲本科临床学习。',
  'Search cases…': '搜索病例……',
  'Search cases': '搜索病例',
  'All specialties': '全部专科',
  'Filter by specialty': '按专科筛选',
  'No matching cases': '没有匹配的病例',
  'Try a different search or specialty.': '请尝试其他关键词或专科。',
  'In progress': '进行中',
  'Browse cases': '浏览病例',
  'Back to case library': '返回病例库',
  'Your task': '你的任务',
  'Learning focus': '学习重点',
  'Begin consultation': '开始问诊',
  'Preparing patient…': '正在准备患者……',
  'This is a formative learning activity with a synthetic patient. It is not clinical advice or an examination result.': '这是使用合成患者的形成性学习活动，不构成临床建议或考试结果。',
  'Clinical consultation': '临床问诊',
  'AI standardised patient · Formative practice': 'AI 标准化患者 · 形成性练习',
  'End consultation': '结束问诊',
  'Evaluating…': '正在评价……',
  'Do not enter real patient information.': '请勿输入真实患者信息。',
  'This is a synthetic formative simulation, not clinical care. The simulated patient will only share information in response to appropriate questions.': '这是合成患者的形成性模拟，不是临床诊疗。模拟患者只会针对恰当的问题提供信息。',
  You: '你',
  Patient: '患者',
  'Begin when you are ready.': '准备好后即可开始。',
  'Introduce yourself and confirm the patient\'s identity.': '请先自我介绍并确认患者身份。',
  'Question for the simulated patient': '向模拟患者提问',
  'Do not include real patient data · Press Enter to send · Shift + Enter for a new line': '请勿输入真实患者信息 · 按 Enter 发送 · Shift + Enter 换行',
  'Practice history': '练习记录',
  'Preparing your feedback…': '正在准备反馈……',
  'Formative feedback': '形成性反馈',
  'What you did well': '做得好的地方',
  'Focus for next time': '下次练习重点',
  'Safety-critical questions to revisit': '需要重新练习的安全关键问题',
  'Performance by domain': '按评价域查看表现',
  'Each score is linked to transcript evidence': '每项成绩都关联到对话证据',
  'Practise another case': '练习其他病例',
  'Feedback is formative and generated from this consultation transcript.': '反馈为形成性反馈，基于本次问诊记录生成。',
  'Create a case': '创建病例',
  'New case': '新建病例',
  'Create, version, preview and publish structured AI patient cases.': '创建、管理版本、预览并发布结构化 AI 患者病例。',
  'All statuses': '全部状态',
  Draft: '草稿',
  Published: '已发布',
  Archived: '已归档',
  Active: '进行中',
  Completed: '已完成',
  Evaluating: '评价中',
  Excellent: '优秀',
  Competent: '胜任',
  Developing: '发展中',
  'Needs improvement': '需要改进',
  Adjusted: '教师已调整',
  'AI assessed': 'AI 评价',
  Case: '病例',
  Specialty: '专科',
  Status: '状态',
  Version: '版本',
  Attempts: '练习次数',
  Actions: '操作',
  'Create a new case or adjust your filters.': '创建新病例或调整筛选条件。',
  'New rubric': '新建评分表',
  'Publish changes': '发布修改',
  Publish: '发布',
  Archive: '归档',
  'Save new version': '保存新版本',
  'Define observable, behaviour-anchored history-taking criteria. Weights must total 100%.': '定义可观察、以行为为基础的病史采集标准。权重总和必须为 100%。',
  'Rubric name': '评分表名称',
  Description: '描述',
  'Total weight': '总权重',
  'Ready to save': '可以保存',
  'Must equal 100%': '必须等于 100%',
  'Assessment domain': '评价域',
  'Weight %': '权重 %',
  'Safety critical': '安全关键',
  'Red flag fact IDs': '红旗事实 ID',
  'Behaviour anchors (0–3)': '行为锚点（0–3）',
  'Add assessment domain': '添加评价域',
  'Teaching overview': '教学概览',
  'Manage structured cases and monitor the quality of formative history-taking practice.': '管理结构化病例，监测形成性病史采集练习质量。',
  'Published cases': '已发布病例',
  'Ready for practice': '可供练习',
  'Total attempts': '练习总数',
  'All demonstration activity': '全部演示活动',
  'Completion rate': '完成率',
  'Started to evaluated': '从开始到完成评价',
  'Median score': '成绩中位数',
  'Formative score / 100': '形成性成绩 / 100',
  'Recent results': '最近成绩',
  'View all': '查看全部',
  'Completed attempts will appear here.': '已完成的练习会显示在这里。',
  'Commonly missed': '常见遗漏',
  'More practice data is needed.': '需要更多练习数据。',
  'Patterns from demonstration attempts. Treat small samples cautiously and review the underlying transcript evidence.': '查看演示练习中的规律。小样本需要谨慎解读，并结合底层对话证据复核。',
  'All case starts': '全部病例开始次数',
  'Evaluated attempts': '已评价练习',
  'Across completed attempts': '基于已完成练习',
  'Current case versions': '当前病例版本',
  'Mean formative score for each assessment domain.': '各评价域的形成性平均成绩。',
  'Completed attempts grouped by formative score band.': '按形成性成绩区间统计已完成练习。',
  'Complete a consultation to populate domain performance.': '完成一次问诊后，这里会显示各评价域表现。',
  'Completed attempts will appear here by score band.': '完成的练习会按成绩区间显示在这里。',
  'Commonly missed questions': '常见遗漏问题',
  'Use these signals to adjust teaching, cases and rubric guidance.': '使用这些信号调整教学、病例和评分表指导。',
  'Not enough evaluated attempts to identify reliable patterns.': '已评价练习不足，暂时无法识别可靠规律。',
}

// Deep-route UI labels are kept in one place so the language switch remains
// consistent even on pages that are mounted after the toggle.
Object.assign(zh, {
  'minutes': '分钟',
  'Case management': '病例管理',
  'Clinical content': '临床内容',
  'Create, version, preview and publish structured AI patient cases.': '创建、管理版本、预览并发布结构化 AI 患者病例。',
  'Search cases…': '搜索病例……',
  'All statuses': '全部状态',
  'Case': '病例',
  'Specialty': '专科',
  'Status': '状态',
  'Version': '版本',
  'Attempts': '练习次数',
  'Actions': '操作',
  'Edit': '编辑',
  'Preview': '预览',
  'Duplicate': '复制',
  'No matching cases': '没有匹配的病例',
  'Create a new case or adjust your filters.': '创建新病例或调整筛选条件。',
  'Edit structured case': '编辑结构化病例',
  'New structured case': '新建结构化病例',
  'Edit case': '编辑病例',
  'Create a case': '创建病例',
  'Only information contained in the structured case can be disclosed by the AI patient.': 'AI 患者只能披露结构化病例中包含的信息。',
  'Save draft': '保存草稿',
  'Case overview': '病例概览',
  'Case title': '病例标题',
  'Student-facing subtitle': '学生端副标题',
  'e.g. Pressure in my chest': '例如：我的胸口有压迫感',
  'A concise, non-revealing introduction': '简洁且不透露诊断的介绍',
  'Choose the primary teaching context for catalogue filtering.': '选择用于目录筛选的主要教学场景。',
  'Clinical setting': '临床场景',
  'Difficulty': '难度',
  'Time allowed (minutes)': '限定时间（分钟）',
  'Student task': '学生任务',
  'Patient identity and presentation': '患者身份与主诉表现',
  'Patient name': '患者姓名',
  'Age': '年龄',
  'Presenting complaint': '主诉',
  'Opening statement': '开场陈述',
  'Clinical source of truth. Include onset, symptoms and patient language.': '临床事实来源。请包含起病时间、症状和患者原话。',
  'The first sentence the patient says when the consultation starts.': '问诊开始时患者说的第一句话。',
  'Structured patient facts': '结构化患者事实',
  'The AI may only disclose these facts in response to an appropriate question.': 'AI 只能在学生提出恰当问题后披露这些事实。',
  'Add fact': '添加事实',
  'Fact': '事实',
  'Remove fact': '移除事实',
  'Label': '标签',
  'e.g. Symptom onset': '例如：症状起始时间',
  'Category': '类别',
  'Associated symptoms': '伴随症状',
  'Red flag': '红旗信号',
  'Past history': '既往史',
  'Medication': '用药史',
  'Allergy': '过敏史',
  'Family history': '家族史',
  'Social history': '社会史',
  'Patient perspective': '患者观点',
  'Patient fact': '患者事实',
  'Disclosure level': '披露层级',
  'Opening': '开场主动披露',
  'Broad question': '宽泛问题',
  'Direct question': '直接问题',
  'Specific question': '具体问题',
  'Stable fact ID': '稳定事实 ID',
  'Generated automatically': '自动生成',
  'Keep unchanged once this case has been used.': '病例使用后请保持不变。',
  'Learning objectives': '学习目标',
  'Add objective': '添加目标',
  'Assessment rubric': '评价评分表',
  'Linked rubric': '关联评分表',
  'Select a rubric': '选择评分表',
  'A published rubric is required before this case can be published.': '发布病例前必须关联已发布的评分表。',
  'Educator note': '教师备注',
  'Preview the patient before publishing. Check that the AI answers consistently, does not volunteer hidden facts and responds safely to escalation.': '发布前请预览患者。确认 AI 回答一致，不会主动透露隐藏事实，并能安全响应升级提问。',
  'Educator preview': '教师预览',
  'Review the student-facing brief alongside the structured patient identity before publication.': '发布前同时检查学生端简介和结构化患者身份。',
  'Student view': '学生视角',
  'Patient identity': '患者身份',
  'Name': '姓名',
  'Not specified': '未填写',
  'Stored in structured case data': '已存储于结构化病例数据',
  'No rubric linked': '未关联评分表',
  'Assessment review': '评价复核',
  'Inspect complete transcripts, evidence and AI-generated formative assessments.': '查看完整对话、证据和 AI 生成的形成性评价。',
  'Search results…': '搜索成绩……',
  'All reviews': '全部复核状态',
  'Educator adjusted': '教师已调整',
  'AI score only': '仅 AI 成绩',
  'Student': '学生',
  'Completed': '已完成',
  'Score': '成绩',
  'Level': '等级',
  'Review': '复核',
  'No matching results': '没有匹配的成绩',
  'Completed, evaluated attempts will appear here.': '已完成并评价的练习会显示在这里。',
  'Attempt review': '练习复核',
  'AI score': 'AI 成绩',
  'Final score': '最终成绩',
  'Assessment evidence': '评价证据',
  'Consultation transcript': '问诊对话记录',
  'Educator review': '教师复核',
  'Adjust the score only when the transcript evidence does not support the automated assessment.': '只有当对话证据不支持自动评价时才调整成绩。',
  'Final score / 100': '最终成绩 / 100',
  'Comment and rationale': '评语与调整理由',
  'Required rationale for an adjusted score': '调整成绩时必须填写理由',
  'characters · minimum 5': '字符 · 至少 5 个字符',
  'Saving…': '正在保存……',
  'Save review': '保存复核',
  'Educator review saved with an audit record.': '教师复核已保存，并已记录审计信息。',
  'Learning analytics': '学习分析',
  'Patterns from demonstration attempts. Treat small samples cautiously and review the underlying transcript evidence.': '查看演示练习中的规律。小样本需要谨慎解读，并结合底层对话证据复核。',
  'All case starts': '全部病例开始次数',
  'Evaluated attempts': '已评价练习',
  'Across completed attempts': '基于已完成练习',
  'Published cases': '已发布病例',
  'Current case versions': '当前病例版本',
  'Mean formative score for each assessment domain.': '各评价域的形成性平均成绩。',
  'Complete a consultation to populate domain performance.': '完成一次问诊后，这里会显示各评价域表现。',
  'Score distribution': '成绩分布',
  'Completed attempts grouped by formative score band.': '按形成性成绩区间统计已完成练习。',
  'Completed attempts will appear here by score band.': '完成的练习会按成绩区间显示在这里。',
  'Commonly missed questions': '常见遗漏问题',
  'Use these signals to adjust teaching, cases and rubric guidance.': '使用这些信号调整教学、病例和评分表指导。',
  'attempts': '次练习',
  'Not enough evaluated attempts to identify reliable patterns.': '已评价练习不足，暂时无法识别可靠规律。',
  'Rubric editor': '评分表编辑器',
  'Define observable, behaviour-anchored history-taking criteria. Weights must total 100%.': '定义可观察、以行为为基础的病史采集标准。权重总和必须为 100%。',
  'Publish changes': '发布修改',
  'Save new version': '保存新版本',
  'Create rubric': '创建评分表',
  'Unsaved draft': '未保存草稿',
  'No rubrics available.': '暂无评分表。',
  'Ready to save': '可以保存',
  'Must equal 100%': '必须等于 100%',
  'Remove': '移除',
  'Comma-separated. IDs must match stable fact or red flag IDs in the linked case.': '请用逗号分隔。ID 必须匹配关联病例中的稳定事实或红旗 ID。',
  'Score 0 label': '0 分标签',
  'Score 0 description': '0 分描述',
  'Behaviour anchors (0–3)': '行为锚点（0–3）',
  'New assessment domain': '新评价域',
  'New history-taking rubric': '新病史采集评分表',
  'Not demonstrated': '未展示',
  'Emerging': '初步形成',
  'Proficient': '熟练',
  'Case copied as a new draft.': '病例已复制为新草稿。',
  'Case published successfully.': '病例已成功发布。',
  'Case archived successfully.': '病例已成功归档。',
  'Case published as a new immutable version.': '病例已作为新的不可变版本发布。',
  'Draft saved.': '草稿已保存。',
  'Rubric created.': '评分表已创建。',
  'Rubric saved as a new version.': '评分表已保存为新版本。',
  'Rubric published successfully.': '评分表已成功发布。',
  'Rubric archived successfully.': '评分表已成功归档。',
  'End this consultation and generate formative feedback? You cannot add more questions afterwards.': '结束本次问诊并生成形成性反馈吗？结束后不能继续提问。',
  'End this consultation and start generating formative feedback? You cannot add more questions afterwards.': '结束本次问诊并开始生成形成性反馈吗？结束后不能继续提问。',
  'Ending…': '正在结束……',
  'Could not complete the consultation.': '无法完成问诊。',
  'Your consultation has ended. Feedback is being generated in the background; you can leave this page and return later.': '本次问诊已经结束。反馈正在后台生成，你可以离开此页面，稍后再回来查看。',
  'Your formative feedback is ready. Select the completed attempt to review it.': '你的形成性反馈已经生成。请选择已完成的练习进行查看。',
  'One feedback report could not be generated. You can retry it below.': '有一份反馈未能生成，你可以在下方重新尝试。',
  'Feedback generation restarted. You can leave this page and return later.': '反馈已重新开始生成，你可以离开此页面，稍后再回来查看。',
  'Could not restart feedback generation.': '无法重新开始生成反馈。',
  'Generating evidence-linked feedback. This page refreshes automatically.': '正在生成有证据关联的反馈，本页面会自动刷新。',
  'Feedback generation was interrupted. Retry when ready.': '反馈生成中断，可在准备好后重试。',
  'Feedback ready to review.': '反馈已生成，可以查看。',
  'Consultation still in progress.': '问诊仍在进行中。',
  'Evaluation failed': '评价生成失败',
  'Evaluation in progress': '评价生成中',
  'Filter practice attempts': '筛选练习记录',
  'Refresh': '刷新',
  'View feedback': '查看反馈',
  'Continue consultation': '继续问诊',
  'Restarting…': '正在重试……',
  'Retry': '重试',
  'How this formative score is calculated': '形成性评分的计算方式',
  'Seven evidence-linked domains are scored against behaviour anchors from 0 to 3. Domain weights total 100%.': '7 个评价域根据 0–3 分的行为锚点评分，并与对话证据关联；各域权重总和为 100%。',
  'Behaviour-anchored domain score': '行为锚定的评价域得分',
  'Total domain weight': '评价域总权重',
  'Weighted score before any safety cap': '安全封顶前的加权得分',
  'Final total rounded to the nearest whole point before any safety cap': '最终总分先四舍五入到最接近的整数，再应用安全封顶',
  'domain score': '评价域得分',
  'domain weight': '评价域权重',
  'Safety cap applied': '已应用安全封顶',
  'Safety score ceiling': '安全评分上限',
  'A safety-critical history element was not elicited.': '未采集到一项安全关键病史。',
  'This is a product-defined formative score, not a validated high-stakes examination result. Review the linked transcript evidence for each domain.': '这是产品定义的形成性评分，并非经过验证的高风险考试成绩。请结合每个评价域所关联的原始对话证据查看。',
  'weight': '权重',
  'points': '分',
  'A critical red flag was not elicited.': '未采集到一项关键红旗信息。',
  'One or more safety red flags were not elicited.': '未采集到一项或多项安全红旗信息。',
  'Scoring audit': '评分审计',
  'Domain weights total 100%. Positive scores require cited student-turn evidence. Educator adjustment requires an audit rationale.': '评价域权重总和为 100%。正向得分必须引用学生对话轮次证据；教师调整成绩必须填写审计理由。',
  'The patient could not respond. Please ask your question again.': '患者暂时无法回答，请重新提问。',
  'Settings:': '设置：',
  'Send question': '发送问题',
  'Ask the simulated patient a history-taking question…': '向模拟患者提问病史采集问题……',
  'AI standardised patient · Formative practice': 'AI 标准化患者 · 形成性练习',
  'Reviewed by educator': '教师已复核',
  '· Reviewed by educator': '· 教师已复核',
  'out of 100': '满分 100 分',
  published: '已发布',
  draft: '草稿',
  archived: '已归档',
  'General Medicine': '普通内科',
  'Cardiology / Emergency Medicine': '心脏科 / 急诊医学',
  'Respiratory Medicine / General Medicine': '呼吸医学 / 普通内科',
  'Gastroenterology / General Medicine': '胃肠病学 / 普通内科',
  'Neurology / Emergency Medicine': '神经科 / 急诊医学',
  'Endocrinology / General Medicine': '内分泌科 / 普通内科',
  'General practice': '全科诊所',
  'University health general practice clinic': '大学健康中心全科诊所',
  'Same-day acute general practice clinic': '当日急性全科诊所',
  'Emergency department assessment area': '急诊评估区',
  'Emergency department cubicle': '急诊诊室',
  'Monitored emergency department cubicle': '急诊监护诊室',
  'Year 2': '二年级',
  'Year 3': '三年级',
  'Year 4': '四年级',
  domains: '个评价域',
  min: '分钟',
  m: '分',
  'Open navigation': '打开导航',
  'Close navigation': '关闭导航',
  'Back to editor': '返回编辑器',
  Rubric: '评分表',
  'The AI patient preview failed.': 'AI 患者预览失败。',
  'AI patient test': 'AI 患者测试',
  'Test a few student questions before publishing and inspect which facts were disclosed.': '发布前先测试几条学生问题，并检查本轮披露了哪些事实。',
  'Try a question, for example: When did it start?': '试着提问，例如：什么时候开始的？',
  'Testing…': '测试中……',
  'Test patient': '测试患者',
  'Patient response': '患者回答',
  'Facts disclosed this turn': '本轮披露的事实',
  'No structured fact was disclosed.': '本轮没有披露结构化事实。',
  'Publication checks': '发布检查',
  'A published rubric is required.': '必须关联已发布的评分表。',
  'Add a case title.': '请填写病例标题。',
  'Complete the patient identity.': '请补充完整患者身份信息。',
  'Add the opening statement.': '请填写开场陈述。',
  'Add at least one complete patient fact.': '请至少添加一条完整的患者事实。',
  'Fact IDs must be unique.': '事实 ID 必须唯一。',
  'Complete every red flag ID and label.': '请填写每个红旗信号的 ID 和标签。',
  'Safety red flags': '安全红旗信号',
  'Link each safety concern to the facts that demonstrate it.': '将每项安全关注点关联到能够证明它的事实。',
  'Add red flag': '添加红旗信号',
  'Red flag ID': '红旗信号 ID',
  'Linked facts': '关联事实',
  'Required question themes': '必问主题',
  'Add stable fact IDs before linking red flags.': '请先添加稳定事实 ID，再关联红旗信号。',
  'Comma-separated phrases that help the safety check recognise explicit screening.': '用逗号分隔，可帮助安全检查识别明确的筛查问题。',
  'Comma-separated themes used for teacher review and future scoring rules.': '用逗号分隔，用于教师复核和后续评分规则。',
  'No red flags defined yet.': '尚未定义红旗信号。',
  'Patient behaviour rules': '患者行为规则',
  'These rules guide the AI patient when a student asks for unknown information or tries to change the role.': '当学生询问未知信息或试图改变角色时，这些规则用于约束 AI 患者。',
  'Unknown information policy': '未知信息处理规则',
  'Default unknown phrases': '默认未知回答',
  'Actor rules': '患者角色规则',
  'Add rule': '添加规则',
  'Actor rule': '患者规则',
  'Question trigger phrases': '问题触发词',
  'presenting_complaint': '主诉',
  'associated_symptoms': '伴随症状',
  'red_flag': '红旗信号',
  'past_history': '既往史',
  'medication': '用药史',
  'allergy': '过敏史',
  'family_history': '家族史',
  'social_history': '社会史',
  'patient_perspective': '患者观点',
  'opening': '开场主动披露',
  'broad_question': '宽泛问题',
  'direct_question': '直接问题',
  'specific_question': '具体问题'
  , 'Covered': '已覆盖'
  , 'Asked, evidence insufficient': '已询问，但没有足够的得分证据'
  , 'Not asked': '未询问'
  , 'Turn': '第几轮'
  , 'Simulated patient': '模拟患者'
  , 'You (student)': '你（学生）'
  , 'View in transcript': '在对话记录中查看'
  , 'Conversation evidence': '对话证据'
  , 'Select an evidence quote to locate the original turn below.': '点击证据引用，定位下方原始对话轮次。'
  , 'Select a quote to locate the original turn in the transcript.': '点击引用，定位对话记录中的原始轮次。'
  , 'AI quality and model runs': 'AI 质量与模型调用'
  , 'Operational signals for prompt and model calibration. These metrics do not measure student performance.': '用于 Prompt 和模型校准的运行指标，不代表学生表现。'
  , 'successful': '成功'
  , 'Total model calls': '模型调用总数'
  , 'Average latency': '平均延迟'
  , 'Failed calls': '失败调用'
  , 'Tokens': 'Token 数'
  , 'calls': '次调用'
  , 'Recent model runs': '最近模型调用'
  , 'Prompt version': 'Prompt 版本'
  , 'Latency': '延迟'
  , 'Success': '成功'
  , 'Failed': '失败'
  , 'No model runs recorded yet.': '暂时没有模型调用记录。'
  , 'Disclosure planner': '事实披露规划器'
  , 'Patient actor': '患者角色模型'
  , 'Evaluator': '评价模型'
  , 'The request took too long. Please try again.': '请求等待时间过长，请重试。'
  , 'The service is temporarily unreachable. Check your connection and try again.': '暂时无法连接服务，请检查网络后重试。'
  , 'Your session has expired. Please choose a workspace again.': '登录状态已过期，请重新选择工作区。'
  , 'The patient is preparing a response.': '患者正在准备回答。'
  , 'The patient response was interrupted. Your consultation has been refreshed; please try again if the answer is not shown.': '患者回答传输中断。问诊记录已刷新；如果没有显示回答，请重新提问。'
  , 'End consultation?': '结束问诊吗？'
  , 'End and generate feedback': '结束并生成反馈'
  , 'The case editor could not be loaded.': '病例编辑器加载失败。'
  , 'Back to case management': '返回病例管理'
  , 'Complete the case quality checks before publishing.': '请先完成病例发布检查。'
  , 'Red flag without an ID references an unknown fact.': '一项未填写 ID 的红旗信号关联了未知事实。'
  , 'Archive this published case? Existing attempts will keep their saved version.': '归档这个已发布病例吗？现有练习会继续保留其已保存版本。'
  , 'Filter cases by status': '按状态筛选病例'
  , 'Archive this rubric? Published cases must be relinked first.': '归档这个评分表吗？请先为已发布病例重新关联其他评分表。'
  , 'Ask at least one question before ending the consultation.': '请至少提问一次后再结束问诊。'
  , 'Back to practice history': '返回练习记录'
  , 'Cancel response': '取消回答'
  , 'Case management could not be loaded.': '病例管理页面加载失败。'
  , 'Choose another practice status or show all attempts.': '请选择其他练习状态，或查看全部练习。'
  , 'Complete every domain and behaviour anchor before publishing.': '发布前请完整填写每个评价域及其行为锚点。'
  , 'Could not enter this workspace. Please try again.': '无法进入此工作区，请稍后重试。'
  , 'Discard unsaved case changes?': '放弃尚未保存的病例修改吗？'
  , 'Discard unsaved rubric changes?': '放弃尚未保存的评分表修改吗？'
  , 'Educator feedback': '教师反馈'
  , 'Every domain needs a description and complete behaviour anchors for scores 0 to 3.': '每个评价域都需要填写描述，以及 0 至 3 分的完整行为锚点。'
  , 'Filter by review status': '按复核状态筛选'
  , 'Learning objective': '学习目标'
  , 'Next': '下一页'
  , 'No attempts match this filter': '没有符合当前筛选条件的练习'
  , 'Open result': '打开成绩详情'
  , 'Page': '页码'
  , 'Practice history could not be loaded.': '练习记录加载失败。'
  , 'Previous': '上一页'
  , 'Results could not be loaded.': '学生成绩加载失败。'
  , 'Results pages': '成绩分页导航'
  , 'Save your changes before publishing': '请先保存修改，再进行发布。'
  , 'Search results': '搜索成绩'
  , 'Skip to main content': '跳到主要内容'
  , 'Start a new anonymous student profile? This browser will no longer be able to open the current profile history.': '要新建匿名学生身份吗？新建后，本浏览器将无法再打开当前身份的练习记录。'
  , 'Start new student profile': '新建学生身份'
  , 'The case library could not be loaded.': '病例库加载失败。'
  , 'The case preview could not be loaded.': '病例预览加载失败。'
  , 'The consultation could not be loaded.': '问诊加载失败。'
  , 'The faculty dashboard could not be loaded.': '教师仪表盘加载失败。'
  , 'The final score and this comment are visible to the student.': '最终成绩和此评语会向学生显示。'
  , 'The patient response timed out. Your question has been restored; please try again.': '患者回答超时。你的问题已恢复，请重试。'
  , 'The patient response was cancelled. Your question has been restored.': '患者回答已取消。你的问题已恢复。'
  , 'Transcript evidence focused.': '已定位到对话记录中的相关证据。'
  , 'Your educator reviewed the automated assessment. This comment and the final score above are part of your formative feedback.': '教师已复核自动评价。此评语和上方最终成绩均属于你的形成性反馈。'
  , 'Your learning space could not be loaded.': '学习工作区加载失败。'
  , 'evidence-linked domains are scored against behaviour anchors from 0 to 3. Domain weights total 100%.': '个有证据关联的评价域按照 0 至 3 分的行为锚点评分，各域权重总和为 100%。'
  , 'results': '条成绩'
  , 'Adjust the search or review filter.': '请调整搜索条件或复核状态筛选。'
  , 'Loading': '正在加载'
  , 'The case could not be loaded.': '病例加载失败。'
  , 'Feedback could not be loaded.': '反馈加载失败。'
  , 'The result could not be loaded.': '成绩详情加载失败。'
  , 'Discard unsaved review changes?': '放弃尚未保存的复核修改吗？'
  , 'Try again': '重试'
  , 'View chart data': '查看图表数据'
  , 'Mean score': '平均分'
  , 'Score band': '分数区间'
  , 'The case title must contain 2 to 160 characters.': '病例标题必须包含 2 至 160 个字符。'
  , 'Add a student-facing subtitle of up to 1,000 characters.': '请填写不超过 1,000 个字符的学生端副标题。'
  , 'Add a clinical setting of up to 120 characters.': '请填写不超过 120 个字符的临床场景。'
  , 'Add the student task of up to 4,000 characters.': '请填写不超过 4,000 个字符的学生任务。'
  , 'Add the presenting complaint of up to 4,000 characters.': '请填写不超过 4,000 个字符的主诉。'
  , 'Set the consultation duration between 3 and 60 minutes.': '请将问诊时长设置为 3 至 60 分钟。'
  , 'Add an opening statement of up to 2,000 characters.': '请填写不超过 2,000 个字符的开场陈述。'
  , 'Include 1 to 80 complete patient facts within the field limits.': '请添加 1 至 80 条完整且符合长度限制的患者事实。'
  , 'Fact IDs may contain only letters, numbers, dots, underscores, colons and hyphens.': '事实 ID 只能包含字母、数字、点、下划线、冒号和连字符。'
  , 'Each fact may have up to 25 trigger phrases of up to 200 characters.': '每条事实最多可有 25 个触发词，每个不超过 200 个字符。'
  , 'A case may contain up to 40 red flags.': '每个病例最多可包含 40 个红旗信号。'
  , 'Red flag IDs must be unique.': '红旗信号 ID 必须唯一。'
  , 'Complete every red flag with a structurally valid ID and label.': '请为每个红旗信号填写格式有效的 ID 和标签。'
  , 'Every red flag must link to between 1 and 20 patient facts.': '每个红旗信号必须关联 1 至 20 条患者事实。'
  , 'Every linked red flag fact must exist in this case.': '红旗信号关联的每条事实都必须存在于当前病例。'
  , 'Each red flag may have up to 25 required question themes of up to 200 characters.': '每个红旗信号最多可有 25 个必问主题，每个不超过 200 个字符。'
  , 'Learning objectives must be complete, with no more than 20 entries of up to 500 characters.': '学习目标不得留空，最多 20 条，每条不超过 500 个字符。'
  , 'Patient actor rules must be complete, with no more than 20 entries of up to 500 characters.': '患者角色规则不得留空，最多 20 条，每条不超过 500 个字符。'
})

export const useLocaleStore = defineStore('locale', () => {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  const locale = ref<Locale>(stored === 'zh' ? 'zh' : 'en')
  const languageLabel = computed(() => locale.value === 'en' ? '中文' : 'English')

  function syncDocumentLanguage(value: Locale) {
    if (typeof document !== 'undefined') document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en-AU'
  }
  syncDocumentLanguage(locale.value)
  watch(locale, value => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, value)
    syncDocumentLanguage(value)
  })

  function toggle() {
    locale.value = locale.value === 'en' ? 'zh' : 'en'
  }

  function t(key: string) {
    return locale.value === 'zh' ? zh[key] ?? key : key
  }

  function has(key: string) {
    return Object.prototype.hasOwnProperty.call(zh, key)
  }

  return { locale, languageLabel, toggle, t, has }
})
