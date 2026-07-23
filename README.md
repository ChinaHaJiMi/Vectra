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

---

## 快速开始

### 方式一：纯前端（零安装）

直接打开 `index.html` 即可运行。  
数据存储在浏览器 `localStorage` 中，刷新页面数据不丢失。

### 方式二：启动后端服务器（推荐）

后端服务器提供文件系统持久化存储，支持多世界管理。

```bash
# 启动（默认端口 8080）
python3 server.py

# 访问
open http://localhost:8080
```

数据存储位置：`~/VectraData/`

#### 后端 API 路由

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/status` | GET | 服务器状态 |
| `/api/loadWorldList` | GET | 加载世界列表 |
| `/api/saveWorldList` | POST | 保存世界列表 |
| `/api/loadWorldData/{id}` | GET | 加载世界数据 |
| `/api/saveWorldData/{id}` | POST | 保存世界数据 |
| `/api/deleteWorld/{id}` | POST | 删除世界 |
| `/api/loadNPCMemory/{worldId}/{npcId}` | GET | 加载 NPC 长期记忆 |
| `/api/saveNPCMemory/{worldId}/{npcId}` | POST | 保存 NPC 长期记忆 |

---

## 使用流程

### 1. 新建世界

点击左侧栏「＋ 新建世界」，输入名称。

### 2. 创世四阶段

| 阶段 | 描述 |
|------|------|
| **① 世界设定书** | 设定世界观、法则、纪元。可手动编写，或与播种者对话生成 |
| **② 居民名册** | 创建 NPC 居民，播种者也可批量生成 |
| **③ 往事蓝图** | 设定故事线、事件节点 |
| **④ 启动世界** | 点击「▶ 开始 PLAY」进入游玩模式 |

### 3. 游玩模式

- **居民列表**（左栏）— 点击 NPC 开始对话
- **场景**（中栏）— 实时对话展示
- **事件日志**（右栏）— 世界事件记录，点击可加载到场景
- **时钟**（顶栏）— 游戏内时间推进，支持倍速和暂停

### 4. 保存与恢复

已启动的世界会自动标记为 `launched`，下次打开浏览器或切换世界时自动进入游玩模式，历史对话和事件完整恢复。

---

## 配置

### API 设置

点击侧边栏 ⚙ 按钮，配置：

| 参数 | 说明 |
|------|------|
| **API 端点** | OpenAI 格式 API 端点（支持 OpenAI / DeepSeek / 任何兼容端点） |
| **API Key** | 你的 API 密钥 |
| **模型 ID** | 模型名称，如 `gpt-4o`、`deepseek-chat` 等 |
| **Temperature** | 创造力系数 (0~2) |
| **Max Tokens** | 最大生成长度 |

---

## 项目结构

```
Vectra/
├── index.html          # 主页面（三栏布局 + 模态框）
├── css/
│   └── style.css       # 暗色科幻主题样式
├── js/
│   ├── app.js          # 核心逻辑（状态机 + LLM调用 + 渲染）
│   └── storage.js      # 存储层（server / localStorage 自动检测）
├── server.py           # Python 后端服务器
├── README.md
├── LICENSE
└── CHANGELOG.md
```

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | 原生 HTML + CSS + JavaScript（零依赖） |
| 后端 | Python 标准库 `http.server`（零依赖） |
| LLM 接口 | OpenAI 格式 API（兼容 DeepSeek 等） |
| 存储 | 文件系统 / localStorage 双轨 |

---

## 兼容性

- **浏览器**: Chrome, Firefox, Safari, Edge 最新版
- **Python**: 3.7+
- **操作系统**: Windows / macOS / Linux

---

## 许可证

本项目采用 MIT 许可证

## 致谢
- 致敬所有的开源作者们
- 致敬所有时刻奋战在一线的计算机工作者们

## 闲话&搞笑后记
- 开发者是一只啥也不会的哈基米，第一次用GitHub，请多多指教哈
- 哦对了，你不会以为这代码是本喵写的？（哪为什么注释这样多
- Ai写的阿，Agent：cline全家桶 模型：DeepSeek V4 Flash
- 本喵一点代码都不会（除了cin>>和print()）交bug记得写简单点（太难看不懂）
- 想看开发者日常点个心，以后会用AI写更多胡思乱想…阿不，奇思妙想
- 代码99%都是DeepSeek写的，不会有人误会代码全是我手写吧？
- 文明交流，共创好环境，不然开发者就要哈气了


