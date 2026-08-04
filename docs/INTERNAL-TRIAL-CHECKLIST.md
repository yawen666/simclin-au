# SimClin AU 1.0 内部试用清单

## 当前结论

1.0 已保留 Vue 3 前端和原有产品设计，API 重构为 Python 3.12 + FastAPI，数据层为原生 `sqlite3` + WAL。迁移后的最终自动化数据请以 [TEST-REPORT.md](./TEST-REPORT.md) 的回填结果为准；未全部通过前，不开始正式试点。

## 启动方式

要求 Python 3.12、Node.js 20.19+ 或 22.12+ 和 npm。在项目根目录执行：

```bash
python3.12 -m venv server/.venv
server/.venv/bin/python -m pip install --upgrade pip
server/.venv/bin/pip install -r server/requirements-dev.txt
npm install
npm --prefix web install
cp server/.env.example server/.env   # 仅在本地文件不存在时
npm run dev
```

打开 `http://localhost:5173`，API 健康检查为 `http://localhost:4100/api/health`。本地开发使用内置演示身份，不需要密码；生产教师入口必须填写 Render 生成的访问码：

- Student：Alex Morgan
- Faculty：Dr Sarah Chen

真实 DeepSeek 配置只由 Python API 读取 `server/.env`，浏览器、客户端请求、日志与截图都不应出现 API key。自动浏览器回归必须显式使用 `AI_PROVIDER=mock`；试用环境必须使用 `deepseek`。

## 试用前环境检查

- [ ] `npm run lint:api && npm run build && npm run test && npm run test:e2e` 全部通过。
- [ ] 真实模型 smoke 和五病例 regression 已通过，输出中无 key、prompt 或患者隐藏事实。
- [ ] `/api/health` 返回 `status=ok`、`database=ok`、`runtime=python`、`schemaVersion=5` 和 `facultyAccessProtected=true`，不返回任何密钥或访问码内容。
- [ ] 生产环境缺少 `FACULTY_DEMO_ACCESS_CODE` 或 DeepSeek key 时启动失败；教师访问码只从 Render Environment 页面向授权教师分享。
- [ ] 学生病例详情响应不包含 `content`、`caseData`、`clinicalTruth`、`atomicFacts`、教师注释或评分材料。
- [ ] 已确认只启动一个 Uvicorn worker，未水平扩容 API 实例。
- [ ] SQLite `integrity_check` 为 `ok`，外键检查无记录。
- [ ] 如为 Render 免费实例，所有参与者已知情：重启/重部署可丢失数据，仅限短时演示。
- [ ] 如为稳定纵向试点，已获得用户对 Render Starter + `/var/data` 持久盘的明确批准，且 `DATABASE_PATH=/var/data/simclin-au.db`、备份与恢复演练均已完成。

## 建议试用顺序

### 学生端

1. 进入 Student，检查 English / 中文界面切换。
2. 从 Case library 选择一个病例，开始问诊。
3. 先自我介绍并确认患者身份，再依次询问主诉、时间线、相关症状、既往史、用药/过敏和患者担忧。
4. 确认流式回答角色为患者，时间为真实显示，界面不出现内部 Turn 编号。
5. 点击结束问诊，确认页面进入 `evaluating`，而不是等待一个长请求。
6. 评价进行时离开页面，从 Practice history 重新打开结果。
7. 检查总分、评价域、证据引用、红旗问题和改进建议；证据能跳转原始对话，反馈不显示数据库 turn ID。
8. 刷新页面后，已完成问诊和反馈仍能打开。

### 教师端

1. 进入 Faculty → Case management，检查结构化患者事实、披露层级、触发词和红旗关联。
2. 在 Preview 页面分别测试开放问题、具体病史问题和要求诊断的问题。
3. 确认 AI 只披露当前允许的事实，不暴露诊断、评分规则、prompt 或事实 ID。
4. 在 Rubrics 检查权重总和、红旗 ID、0–3 行为锚点和发布状态。
5. 新建或编辑病例，确认未通过完整性/红旗 ID 校验时无法发布；发布后旧 session 仍锁定旧版本。
6. 在 Results 查看完整问诊、评价证据，并用合法理由进行教师改分；原 AI 分数不被覆盖。
7. 在 Insights 检查评价域、得分分布、常见遗漏和 model-run 质量信息。

## 异常和恢复演练

- [ ] 人工中断一次 SSE 回答，确认失败的学生问题不进入后续评分证据。
- [ ] 使用测试 provider 制造一次可重试评价错误，确认第二次成功且两次 `model_runs` 均可审计。
- [ ] 在评价为 `queued` 或 `running` 时重启 API，确认启动后自动恢复并只生成一条 evaluation。
- [ ] 模拟 DeepSeek 超时/空响应，确认前端只显示安全错误信息，供应商响应与密钥不会透出。

## 试用边界

- 所有病例和人物均为合成教学数据，禁止输入真实患者信息。
- 当前结果是形成性反馈，不是正式考试成绩或临床能力认证。
- 病例尚未经医学院课程委员会、专业教师和隐私/伦理治理正式签署。
- 试用期间记录 AI 异常的病例、问题原文、时间和截图，但不记录密钥或真实患者数据。
- 更换环境或公开分享前，必须轮换开发期 DeepSeek API key。

## 回归命令

```bash
npm run lint:api
npm run build
npm run test
npm run test:e2e
npm run test:smoke:real
npm run test:regression:real
```
