# SimClin AU 1.0 测试报告

测试日期：2026-08-04
当前状态：**Vue 3 + FastAPI/Python 3.12 + SQLite 重构已通过 1.0 迁移验收**

## 验收结论

Python API 保留了现有 Vue 前端的 REST、错误包装与 SSE 契约。发布前已在最终代码上一次性运行完整自动化门禁，并另外运行真实 DeepSeek smoke、五病例 regression、旧数据库迁移副本检查和密钥特征扫描；所有检查通过。

## Python 迁移验收结果

| 检查项 | 结果 | 实测记录 |
| --- | --- | --- |
| Ruff Python 静态与格式检查 | 通过 | 31 个 Python 文件通过 `ruff check` 与 `ruff format --check` |
| Python `compileall` + Vue/Vite 生产构建 | 通过 | API 编译通过；Vue 生产包成功构建 |
| FastAPI/SQLite `pytest` 单元与 API 契约 | 通过 | 28/28；包含旧 Node schema 迁移 fixture |
| Vue Vitest | 通过 | 5/5（3 个测试文件） |
| Playwright 桌面端与移动端 | 通过 | 11/11，13.6 秒 |
| 真实 DeepSeek smoke | 通过 | 1/1；仅记录脱敏状态、病例标识、评分与 criterion 数量 |
| 五病例真实模型 regression | 通过 | 5/5；五个病例均完成患者回复与后台结构化评价 |
| SQLite 完整性与迁移兼容 | 通过 | 当前库 `integrity_check=ok`、无外键错误；旧 Node 数据库副本迁移至 schema 5 后同样通过 |
| 密钥扫描（排除本地 `server/.env`） | 通过 | 未发现常见 API key 或私钥特征；本地环境文件仍被 Git 忽略 |

## 必须覆盖的 1.0 契约

### API 与前端兼容

- 演示角色 JWT 登录、学生/教师越权拒绝、统一 `code/message/error` 错误包装。
- 生产环境必须配置教师访问码和 DeepSeek key；学生病例详情不能返回诊断、原子事实、教师注释或评分材料。
- 病例、评分表、发布版本、复制、归档、预览、成绩、改分、历史和洞察的现有 REST 响应形状。
- `/messages` 同时接受 `message` 和旧 `content` 字段；SSE 依次发送 `meta`/`delta`/`complete` 或 `error`，完成负载保留 `type: done`。
- 失败 turn 仅留在数据库审计，不进入后续 Planner/Actor/Evaluator 上下文、用户可见 transcript 或问题计数。

### 数据库与后台评价

- 原生 `sqlite3` 启用外键、WAL、五秒 `busy_timeout`，启动建表/补列/播种幂等。
- 旧 SQLite 表和版本快照能被 Python API 继续读取，已发布病例与 rubric 不被重播种覆盖。
- `POST /complete` 返回 HTTP 202 / `evaluating`，学生可离开页面后从 Practice history 轮询结果。
- 可重试的评价供应商错误至多自动补试一次；进程重启后恢复 SQLite 中 `queued` / `running` 且未生成 evaluation 的工作。
- 评分仍执行证据 turn 白名单、criterion/red-flag ID 白名单、权重归一化和红旗封顶。
- 畸形 JWT、普通或 chunked 超大请求、AI 小时预算和不完整/伪造评价域均有自动化拒绝测试。

### UI 与产品闭环

- 五个预置病例、学生 SSE 问诊、后台评价、Practice history 反查、教师证据复核/审计改分。
- 自动化验证登录页 English / 中文切换持久化、学生/教师核心闭环以及 Pixel 5 核心路径。
- 侧栏、问诊页、病例编辑、rubric、成绩和洞察页的逐页双语一致性，以及 1280×720 横向溢出，仍按内部试用清单人工验收。
- 真实时间、学生/患者角色和隐藏内部 turn 编号属于发布前人工视觉验收项，不以自动化用例数量代替。

## 迁移前基线（仅作对照）

重构前的 Node/Fastify 版本曾记录：后端 Vitest 33/33、前端 Vitest 5/5、Playwright 11/11，以及真实 DeepSeek smoke 与五病例 regression 通过。这些数字只是重构前的行为基线，**不是 Python 迁移版的最终验收结果**。

## 已知边界

- 教师 Preview 是结构化病例预览与单轮回答测试，不是完整课程试考。
- 形成性评分支持教师复核，但尚无正式成绩册、学校 SSO、真实学生账号或多租户治理。
- 病例、rubric、红旗与反馈语言仍需澳洲医学院教师、临床专家和隐私/伦理治理签字。
- 当前 `render.yaml` 仍是免费实例且磁盘临时；纵向试点前必须经用户批准改为 Starter + `/var/data` 持久盘。
- 当前身份仍是内置演示身份而非学校 SSO；生产教师身份由部署专用访问码保护，学生入口受 AI 小时预算约束。

## 本地复现

在项目根目录执行：

```bash
npm run lint:api
npm run build
npm run test
npm run test:e2e
npm run test:smoke:real
npm run test:regression:real
```

Playwright 使用隔离的临时 SQLite 数据库和显式 `mock` provider；真实模型命令只从已忽略的 `server/.env` 读取配置，日志和报告不得输出 key。
