# Changelog

All notable changes to VECTRA will be documented in this file.

## [2.0.0] — 2025-09-05 大转向：对话网页 → 无头 AI 叙事引擎

### Breaking / Removed
- **移除全部旧 WebUI**（`index.html`、`css/`、`js/` 含小恐龙彩蛋与烟花、
  `install/`、`release/`）—— VECTRA 不再自带前端，只做叙事后端。
- 移除旧的浏览器 localStorage 模式与 CSRF 流程（现在是无头 REST 服务）。

### Added
- **无头 AI 叙事引擎**：零依赖 Python 服务，供 Unity/Godot/Cocos 等 2D 游戏
  引擎以 HTTP/SSE 驱动，覆盖三大叙事能力：
  - **叙事摘要**：`POST /summarize` 滚动压缩 · `GET /summary`
  - **信息整合**：`POST /integrate` 把事件凝练为结构化事实 + 角色记忆 + 关系边
  - **NPC 关系图**：`GET /graph`（节点=实体，边带 好感/信任/熟悉度，随事件演化）
- 事件台账（events.jsonl）、事实库（facts.jsonl）、每实体记忆流（memories/*.jsonl
  + 索引）、图（graph.json）、摘要（summary.json），按 `cursors.ingested/
  integrated/summarized` 游标增量推进。
- **离线确定性兜底**：未配 LLM Key 时整合/摘要/生成走启发式，输出结构与在线一致，
  便于无 Key 测试与单元测试。
- LLM 编排（`vectra/brain.py`）：OpenAI 兼容 API，逐世界可配 endpoint/key/model，
  `POST /narrate` 支持 SSE 流式生成。
- **NPC 行为决策 `decide`**：从"只对话"迈向"全 AI 驱动行为" —— `POST /decide`
  让 NPC 依据 角色卡+记忆+关系+场景 产出结构化意图；动作只能从技能清单
  `SKILL_MANIFEST`（move/social/item/combat 共 9 种）选择，可用 `groups` 过滤，
  非法动作强制纠正；离线有确定性决策兜底，技能由游戏侧实现即可驱动真实行为。
- **SSE 订阅推送 `/stream` + 自主决策泵**：解决"Vectra→游戏 主动消息"。游戏连上
  `/worlds/{id}/stream` 订阅后，Vectra 侧自主泵按 `cadence` 轮流让活跃 NPC
  `decide` 并把意图实时推送（`event: npc.intent`）；无订阅者则不自主触发，
  避免空转烧 token。`PATCH /worlds/{id}` 支持 `{"autonomous":true,"cadence":N}`。
- 完整 REST 契约 `openapi.yaml` + 参考调用链 `samples/demo_client.py`。
- 写操作可选 `X-Vectra-Token` 共享令牌门禁；目录穿越净化沿用。

## [1.x] — 旧版本（AI NPC 模拟网页）

### Added
- NPC 关系图谱可视化
- 多 NPC 同时在线对话
- 场景地图/网格编辑器
- 一键安装发行版脚本（Windows `install.bat` / Linux·macOS `install.sh`）
- 服务器支持 `VECTRA_NO_SSL=1`（HTTP 直连）与 `VECTRA_PORT` 环境变量
- **结构化记忆系统 v2**：NPC 长期记忆按条目存储（JSONL + 索引），支持按标签/时间/重要度检索
- **NPC 行为契约**：每个 NPC 可设定「说话风格 / 口头禅 / 习惯动作」
- 记忆档案浏览器：按标签筛选、检索、编辑、删除记忆条目

### Changed
- 默认桌面启动方式改为 HTTP 直连，浏览器无自签名证书警告
- 移除仓库内 `.bak` / `.cph` / gitleaks 报告等垃圾文件
- NPC 回复提示词 v2：身份锁定合并、记忆主动引用、神态动作格式化
- `storageSave()` 防抖（500ms），本地服务器限流调整

## [1.0.0] — 2024-07-23

### Added

#### 核心架构
- 四阶段创世状态机（世界设定书 → 居民名册 → 往事蓝图 → 启动世界）
- 双模式切换：创世模式 + 游玩模式
- 纯前端零依赖架构，HTML + CSS + JavaScript

#### 创世模式
- 播种者（THE SOWER）AI 对话界面
- 结构化输出协议 `[DRAFT]{...}[/DRAFT]`，支持 JSON 自动解析与填充
- 世界设定书内联编辑器（世界观/法则/纪元）
- 手动定稿按钮，每阶段可确认后推进
- NPC 居民名册卡牌展示，支持创建/编辑/删除
- 往事蓝图节点管理，支持 6 种事件类型（主线/支线/对话/调查/道具/好感）
- 播种者消息悬浮编辑按钮

#### 游玩模式
- 三栏布局：居民列表 + 场景对话 + 事件日志
- NPC AI 实时对话，沉浸式第一人称角色扮演提示词
- 游戏内时钟系统，时间持续流动
- 倍速控制（0.5× / 1× / 2× / 5×）
- 暂停/继续时间流动
- NPC 选中交互，点击居民开始对话
- 事件日志，点击条目可加载到场景

#### 记忆系统
- 短期记忆（NPC 上下文窗口，自动记录对话摘要）
- 长期记忆（Markdown 文件持久化，记忆档案模态框查看编辑）
- 记忆模态框支持读写短期/长期记忆

#### 存储系统
- 双轨存储架构：`server.py` 后端文件系统 + `localStorage` 自动回退
- Python 后端服务器（端口 8080），零依赖标准库
- 8 个 RESTful API 路由
- 世界列表、世界数据、NPC 记忆的完整 CRUD
- 用户目录 `~/VectraData/` 整齐存储

#### UI/UX
- 暗色科幻主题样式
- 左侧世界列表 + 新建/删除世界
- API 设置模态框（端点/Key/模型/Temperature/MaxTokens）
- 测试连接按钮
- 世界启动后自动进入游玩模式（`launched` 标记持久化）
- 已启动世界锁定创世编辑，播种者对话禁用
- 浏览器缓存版本号控制

#### NPC 对话系统
- OpenAI 格式 API 调用（兼容 DeepSeek 等）
- 对话历史注入 LLM 上下文
- 沉浸式第一人称 system prompt，动态读取 NPC 数据
- 零硬编码预设，全部字段从运行时状态读取

### Fixed
- 浏览器缓存不更新问题（CSS/JS 版本号递增）
- 对话只发单轮的 bug（改为注入完整对话历史）
- DRAFT 正则不支持换行的问题
- 确认按钮不显示的条件判断
- File System Access API 不兼容（后端替代方案）
- 新建世界时未重置 scene 数组

### Changed
- 告别预置数据，完全由用户生成
- 播种者响应从模拟回复改为真实 LLM 调用
- 模型从下拉选择改为手动输入
- 右侧面板在无世界时隐藏
- 世界已启动时自动恢复游玩状态

---

之前版本号风格不统一，从本版本开始统一使用语义化版本。