# SimClin AU 1.0 内部试用清单

## 当前结论

真实 DeepSeek Provider 已完成合成病例联调：

- 最小闭环 smoke：通过，完成 Planner → Actor → Evaluator → 结构化评分。
- 5 个预置病例回归：全部通过。
- 每个病例均返回 7 个评价域，患者回答未发现系统提示、评分规则或事实 ID 泄露。

## 启动方式

在项目目录执行：

```bash
npm install
npm --prefix server install
npm --prefix web install
npm run dev
```

打开 `http://localhost:5173`。当前使用内置演示身份，不需要注册或登录密码：

- Student：Alex Morgan
- Faculty：Dr Sarah Chen

真实 DeepSeek 配置只读取 `server/.env`，浏览器不会接触 API Key。

## 建议试用顺序

### 学生端

1. 进入 Student。
2. 从 Case library 选择一个病例。
3. 开始问诊，先自我介绍并确认患者身份。
4. 依次询问主诉、时间线、相关症状、既往史、用药/过敏和患者担忧。
5. 点击结束问诊。
6. 检查总分、评价域、证据引用、红旗问题和改进建议。
7. 点击评价证据，确认可以跳转到对应原始对话。
8. 回到 Practice history，重新打开本次反馈。

### 教师端

1. 进入 Faculty → Case management。
2. 打开一个病例，检查结构化患者事实、披露层级、触发词和红旗关联。
3. 在 Preview 页面测试至少三种问题：开放问题、具体病史问题、要求诊断的问题。
4. 确认 AI 只在适当问题下披露事实，不主动暴露隐藏信息。
5. 在 Rubrics 检查权重、红旗 ID 和发布状态。
6. 在 Results 查看完整问诊、评价证据并尝试教师复核改分。
7. 在 Insights 查看成绩趋势和 AI quality and model runs。

## 核心验收标准

- 患者回答保持英文、患者角色和 1–3 句的短回答风格。
- AI 不应输出诊断、评分表内容、Prompt、事实 ID 或系统指令。
- 评价中的正向得分必须能够定位到学生的具体问题。
- 红旗遗漏应有明确的安全问题提示和原因。
- 教师发布病例前必须通过结构化内容检查。
- 学生不能访问教师页面，教师不能以学生身份提交问诊。
- 页面刷新后，已完成问诊和反馈仍能从历史记录打开。

## 试用边界

- 所有病例和人物均为合成教学数据，禁止输入真实患者信息。
- 当前结果是形成性反馈，不是正式考试成绩或临床能力认证。
- 病例尚未经过医学院课程委员会或专业教师正式签署。
- 试用期间建议保留每次 AI 异常回答的病例、问题原文和截图，便于后续 Prompt/病例校准。
- 更换或公开分享环境前，应轮换当前 DeepSeek API Key。

## 回归命令

```bash
npm run build
npm run test
npm run test:e2e
npm --prefix server run test:smoke:real
npm --prefix server run test:regression:real
```

