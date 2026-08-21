# VECTRA — AI NPC 模拟系统

> **VECTRA** 是一个零依赖的 AI 驱动的 NPC（非玩家角色）模拟系统。  
> 你创建世界、设定居民，然后走进这个世界，与 AI 居民实时对话。

---

## 功能概览

| 模块 | 说明 |
|------|------|
| **创世模式**（播种者） | 通过自然语言对话，AI 「播种者」帮你生成世界设定、NPC 居民和故事线 |
| **游玩模式** | 走进你的世界，与 AI NPC 实时对话，时间持续流动 |
| **NPC 双记忆系统** | 短期记忆（上下文窗口） + 长期记忆（文件持久化） |
| **时钟系统** | 游戏内时间持续流动，支持 0.5×/1×/2×/5× 倍速 |
| **世界事件日志** | 自动记录每一次互动和世界变化 |
| **双存储后端** | `server.py` 文件存储 / `localStorage` 自动回退 |
| **NPC 行为契约** | 每个 NPC 可设定说话风格、口头禅、习惯动作 |
| **导演 AI** | 可选的 AI 导演，控制 NPC 回复顺序，避免抢话 |
| **结构化记忆** | NPC 长期记忆按条目存储，支持按标签/时间/重要度检索 |
| **记忆档案浏览器** | 按标签筛选、检索、编辑记忆条目 |

---

## 快速开始

### 方式一：纯前端（零安装）

直接打开 `index.html` 即可运行。  
数据存储在浏览器 `localStorage` 中，刷新页面数据不丢失。

**优点**：无需安装任何依赖，适合快速体验  
**缺点**：数据仅保存在当前浏览器，清除缓存会丢失

### 方式二：启动后端服务器（推荐）

后端服务器提供文件系统持久化存储，支持多世界管理。

```bash
# 启动（默认端口 8080）
python3 server.py

# 访问
open http://localhost:8080
```

数据存储位置：`~/VectraData/`

**优点**：数据持久化保存，支持多浏览器访问  
**缺点**：需要 Python 3.7+ 环境

#### 环境变量配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VECTRA_PORT` | `8080` | 服务器端口 |
| `VECTRA_NO_SSL` | 空 | 设为 `1` 禁用 HTTPS（HTTP 直连） |

#### 后端 API 路由

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/status` | GET | 服务器状态 |
| `/api/csrf-token` | GET | 获取 CSRF 令牌 |
| `/api/loadWorldList` | GET | 加载世界列表 |
| `/api/saveWorldList` | POST | 保存世界列表 |
| `/api/loadWorldData/{id}` | GET | 加载世界数据 |
| `/api/saveWorldData/{id}` | POST | 保存世界数据 |
| `/api/deleteWorld/{id}` | POST | 删除世界 |
| `/api/loadNPCMemory/{worldId}/{npcId}` | GET | 加载 NPC 长期记忆 |
| `/api/saveNPCMemory/{worldId}/{npcId}` | POST | 保存 NPC 长期记忆 |
| `/api/npcMemory/{worldId}/{npcId}/index` | GET | 获取记忆索引 |
| `/api/npcMemory/{worldId}/{npcId}/append` | POST | 追加记忆条目 |
| `/api/npcMemory/{worldId}/{npcId}/query` | POST | 查询记忆条目 |
| `/api/npcMemory/{worldId}/{npcId}/overwrite` | POST | 覆盖记忆条目 |

#### 安全特性

- **CSRF 保护**：所有写操作需要有效的 CSRF 令牌
- **输入净化**：所有用户输入经过过滤和长度限制
- **路径验证**：防止目录遍历攻击
- **限流**：600 请求/分钟/IP（本地开发无需限流）

---

## 使用流程

### 1. 新建世界

点击左侧栏「＋ 新建世界」，输入名称。世界名称会自动转换为 ID（如「中土世界」→ `中土世界`）。

### 2. 创世四阶段

| 阶段 | 描述 | 播种者支持 |
|------|------|------------|
| **① 世界设定书** | 设定世界观、法则、纪元。可手动编写，或与播种者对话生成 | ✅ 可对话生成 |
| **② 居民名册** | 创建 NPC 居民，播种者也可批量生成 | ✅ 可批量生成 |
| **③ 往事蓝图** | 设定故事线、事件节点（支持 6 种类型） | ✅ 可对话生成 |
| **④ 启动世界** | 点击「▶ 开始 PLAY」进入游玩模式 | — |

**创世提示**：
- 每个阶段可手动编辑，也可通过播种者对话生成
- 播种者会返回结构化 JSON，自动填充对应表单
- 每阶段完成后点击「✓ 确认定稿」推进到下一阶段

### 3. 游玩模式

| 区域 | 功能 |
|------|------|
| **居民列表**（左栏） | 点击 NPC 开始对话，显示 NPC 名称和状态 |
| **场景**（中栏） | 实时对话展示，显示 NPC 名称和对话内容 |
| **事件日志**（右栏） | 世界事件记录，点击可加载到场景 |
| **时钟**（顶栏） | 游戏内时间推进，支持倍速和暂停 |
| **广播**（右上角） | 向整个世界广播事件，影响所有 NPC |

**游玩模式功能**：
- **自动对话**：NPC 会主动交流（可关闭）
- **倍速控制**：0.5× / 1× / 2× / 5×
- **时间暂停**：点击暂停按钮停止时间流动
- **返回创世**：点击「← 创世」返回创世模式（仅查看，不可编辑已启动的世界）

### 4. 保存与恢复

已启动的世界会自动标记为 `launched`，下次打开浏览器或切换世界时自动进入游玩模式，历史对话和事件完整恢复。

**保存机制**：
- 自动保存：每次操作后 500ms 防抖自动保存
- 手动保存：点击保存按钮（如果有）
- 存储位置：localStorage（前端）或 `~/VectraData/`（后端）

---

## 配置

### API 设置

点击侧边栏 ⚙ 按钮，配置：

| 参数 | 说明 | 推荐值 |
|------|------|--------|
| **API 端点** | OpenAI 格式 API 端点（支持 OpenAI / DeepSeek / 任何兼容端点） | 见下方表格 |
| **API Key** | 你的 API 密钥 | — |
| **模型 ID** | 模型名称，如 `gpt-4o`、`deepseek-chat` 等 | 见下方表格 |
| **Temperature** | 创造力系数 (0~2) | 0.8 |
| **Max Tokens** | 最大生成长度 | 4096 |
| **自动交流频率** | NPC 主动交流次数/分钟（0=关闭） | 5 |

#### 支持的 API 提供商

| 提供商 | 端点 | 模型示例 | 备注 |
|--------|------|----------|------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o`, `gpt-4o-mini` | 官方 API |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat`, `deepseek-coder` | 性价比高 |
| 本地 Ollama | `http://localhost:11434/v1` | `llama3`, `mistral` | 无需联网 |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-turbo`, `qwen-plus` | 国内访问快 |
| 智谱 AI | `https://open.bigmodel.cn/api/paas/v4` | `glm-4`, `glm-4-flash` | 国内访问快 |

#### 导演 AI（可选）

导演 AI 用于控制每次对话由哪个 NPC 回应，避免无关 NPC 插话、认错人。

| 参数 | 说明 |
|------|------|
| **导演 AI 端点** | 留空则复用上方主 API 端点 |
| **导演 AI Key** | 留空则复用上方主 API Key |
| **导演 AI 模型** | 留空则复用上方主模型 |

**导演工作原理**：
1. 玩家输入对话后，导演 AI 分析当前场景和 NPC 状态
2. 决定哪个 NPC 应该回应（可能多个 NPC 同时回应）
3. 将对话分配给对应的 NPC 处理

---

## 项目结构

```
Vectra/
├── index.html              # 主页面（三栏布局 + 模态框）
├── css/
│   └── style.css           # 暗色科幻主题样式
├── js/
│   ├── app.js              # 核心逻辑（状态机 + LLM调用 + 渲染）
│   ├── storage.js          # 存储层（server / localStorage 自动检测）
│   ├── utils/
│   │   └── sanitize.js     # 输入净化工具
│   ├── trex/
│   │   ├── runner.js       # Chrome 小恐龙游戏核心
│   │   └── assets/         # 游戏资源文件
│   ├── trex.js             # 小恐龙游戏初始化
│   └── fireworks.js        # 烟花特效（启动时播放）
├── install/
│   ├── install.bat         # Windows 一键安装脚本
│   └── install.sh          # Linux/macOS 一键安装脚本
├── release/                # 发行版打包目录
├── server.py               # Python 后端服务器（零依赖）
├── .gitignore              # Git 忽略规则
├── LICENSE                 # MIT 许可证
├── README.md               # 项目说明（本文件）
├── PROJECT_OVERVIEW.md     # 项目详细介绍
└── CHANGELOG.md            # 版本更新日志
```

#### 核心文件说明

| 文件 | 行数 | 说明 |
|------|------|------|
| `js/app.js` | ~2000 | 主逻辑：状态机、LLM 调用、UI 渲染、事件处理 |
| `js/storage.js` | ~400 | 存储适配器：自动检测 server/localStorage |
| `server.py` | ~600 | Python 后端：静态文件服务 + REST API |
| `css/style.css` | ~1500 | 暗色科幻主题样式 |

---

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 前端 | 原生 HTML + CSS + JavaScript | 零依赖，无需 npm/webpack/React |
| 后端 | Python 标准库 `http.server` | 零依赖，无需 pip install |
| LLM 接口 | OpenAI 格式 API | 兼容 DeepSeek、通义千问、智谱 AI 等 |
| 存储 | 文件系统 / localStorage 双轨 | 自动检测，无缝切换 |
| 安全 | CSRF + 输入净化 + 路径验证 | 防止常见 Web 攻击 |
| 证书 | 自签名 SSL/TLS | 默认 HTTPS，可禁用 |

#### 前端架构

- **状态机**：四阶段创世流程 + 双模式切换
- **LLM 调用**：OpenAI 格式 API，支持流式响应
- **渲染**：原生 DOM 操作，无虚拟 DOM
- **存储适配器**：自动检测 server/localStorage

#### 后端架构

- **静态文件服务**：直接托管前端文件
- **REST API**：完整 CRUD 操作
- **安全层**：CSRF、输入净化、路径验证、限流
- **SSL/TLS**：自签名证书，可禁用

---

## 兼容性

### 浏览器

| 浏览器 | 版本 | 状态 |
|--------|------|------|
| Chrome | 最新版 | ✅ 完全支持 |
| Firefox | 最新版 | ✅ 完全支持 |
| Safari | 最新版 | ✅ 完全支持 |
| Edge | 最新版 | ✅ 完全支持 |

**注意**：小恐龙彩蛋仅在 Chrome 内核浏览器可用。

### Python

- **最低版本**：3.7+
- **推荐版本**：3.9+
- **依赖**：零依赖（仅使用标准库）

### 操作系统

| 系统 | 状态 | 备注 |
|------|------|------|
| Windows | ✅ 支持 | 推荐使用 PowerShell 或 CMD |
| macOS | ✅ 支持 | 推荐使用 Terminal |
| Linux | ✅ 支持 | 推荐使用 Bash |

### API 提供商

- **OpenAI**：官方 API，全球可用
- **DeepSeek**：国内访问快，性价比高
- **本地 Ollama**：无需联网，数据隐私

---

## 常见问题

### Q: 数据存储在哪里？

**A:**
- **前端模式**：浏览器 `localStorage`（清除缓存会丢失）
- **后端模式**：`~/VectraData/` 目录（持久化保存）

### Q: 如何切换 API 提供商？

**A:** 点击侧边栏 ⚙ 按钮，修改 API 端点和模型 ID 即可。支持任何 OpenAI 格式的 API。

### Q: 如何备份数据？

**A:**
- **前端模式**：导出 `localStorage` 数据（浏览器开发者工具）
- **后端模式**：直接复制 `~/VectraData/` 目录

### Q: 为什么 NPC 回复很慢？

**A:**
1. 检查网络连接
2. 尝试更换更快的 API 提供商（如 DeepSeek）
3. 降低 `Max Tokens` 值
4. 检查 API 配额是否用完

### Q: 如何添加更多 NPC 类型？

**A:** 编辑 `js/app.js` 中的 NPC 类型定义，或在创世模式中通过播种者对话生成。

### Q: 支持多人同时访问吗？

**A:**
- **前端模式**：不支持（每个浏览器独立）
- **后端模式**：支持（多个浏览器可同时访问同一服务器）

---

## 开发指南

### 环境准备

```bash
# 克隆仓库
git clone https://github.com/your-username/Vectra.git
cd Vectra

# 启动开发服务器（前端模式）
open index.html

# 启动后端服务器
python3 server.py
```

### 代码结构

- **前端**：`js/app.js` 是核心，包含状态机和所有 UI 逻辑
- **后端**：`server.py` 是单文件服务器，包含所有 API 路由
- **样式**：`css/style.css` 是暗色科幻主题

### 调试技巧

1. **浏览器开发者工具**：F12 打开，查看 Console 和 Network
2. **后端日志**：`~/VectraData/server.log`
3. **API 测试**：使用 Postman 或 curl 测试后端 API

### 构建发行版

```bash
# 运行打包脚本
cd release
python3 build.py
```

---

## 贡献指南

### 如何贡献

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m 'Add some feature'`
4. 推送到分支：`git push origin feature/your-feature`
5. 创建 Pull Request

### 代码规范

- **前端**：遵循原生 JavaScript 风格，避免使用框架
- **后端**：遵循 PEP 8 Python 风格
- **注释**：关键逻辑添加注释，但不要过度注释

### 提交规范

- **feat**: 新功能
- **fix**: 修复 bug
- **docs**: 文档更新
- **style**: 代码格式调整
- **refactor**: 代码重构
- **test**: 添加测试
- **chore**: 构建/工具链更新

---

## 许可证

本项目采用 MIT 许可证

## 致谢
- 致敬所有的开源作者们
- 致敬所有时刻奋战在一线的计算机工作者们

## 闲话&搞笑后记
- 开发者是一个啥也不会的哈基米，第一次用GitHub，请多多指教哈
- 哦对了，你不会以为这代码是本人写的？代码99%都是DeepSeek写的（哪为什么注释这样多
- 本人一点代码都不会（除了cin>>和print()这种）交bug记得写简单点（太难看不懂）
- 想看开发者日常点个心，以后会用AI写更多胡思乱想…阿不，奇思妙想
- 文明交流，共创好环境


