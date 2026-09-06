# VECTRA 2 — Headless AI Narrative Engine

> VECTRA 以前是一个"AI NPC 对话网页"。**v2 完成大转向**：它现在是一个**无头的
> 叙事引擎（服务）**，专门做 AI 驱动 2D 游戏的"叙事大脑"。游戏本体（Unity /
> Godot / Cocos，任何能发 HTTP 的引擎）负责渲染、物理、输入；**叙事摘要、信息
> 整合、NPC 关系图、角色记忆、剧情对白生成这些"脑力活"，全部由 VECTRA 包办。**

```
               你的 2D 游戏（Unity 等）                 VECTRA 叙事引擎（本仓库）
   ┌──────────────────────────────────┐        ┌─────────────────────────────┐
   │ 渲染 / 物理 / 输入 / 关卡          │        │  世界清单 · 实体名册          │
   │                                  │  POST  │  事件台账 (events.jsonl)     │
   │  "角色X对角色Y做了某件事" ─────────┼───────▶│        │ 整合(信息整合)          │
   │                                  │        │        ▼                    │
   │  UI 拉去 <── GET /summary ────────┼────────│  事实库 · 角色记忆 · 关系图    │
   │  关系面板 <── GET /graph ─────────┼────────│  滚动叙事摘要 (叙事摘要)       │
   │  剧情文字 <── POST /narrate ──────┼────────│  对白/旁白生成 (SSE 流式)      │
   └──────────────────────────────────┘        └─────────────────────────────┘
```

---

## 核心能力（正是你要的那三块）

| 能力 | 说明 | 端点 |
|------|------|------|
| **叙事摘要** | 把已发生的事件滚动压缩成一段连贯故事，长流程不爆上下文 | `POST /summarize` · `GET /summary` |
| **信息整合** | 把游戏上报的零散事件，凝练成结构化**事实**，写进**角色记忆**并同步到关系网 | `POST /integrate` · `GET /facts` |
| **NPC 关系图** | 节点=实体(角色/玩家/阵营…)，边带 `好感/信任/熟悉度`，随事件自动演化 | `GET /graph` · `GET /graph/{实体}` |
| 角色记忆 | 每个实体一条记忆流（JSONL+索引），按 标签/重要度/时效 加权召回 | `GET|POST .../memories` · `/query` |
| 剧情生成 | 按当前世界状态+摘要+记忆生成旁白/对白，支持 SSE 流式 | `POST /narrate` |
| **NPC 行为决策** | 让 NPC 不止"说话"还会"行动"：返回结构化意图（goal/need/action/speech），动作**只能**从技能清单选 | `POST /decide` · `GET /skills` |

> **为什么这样才是"全 AI 驱动行为"**：AI 不亲手推物理，而是**选动作**。
> `/decide` 读入角色卡+记忆+关系+场景，产出一个意图，其 `action.skill` 恒来自
> 技能清单 `SKILL_MANIFEST`（移动/社交/物品/战斗 9 种）。你的游戏只需在 Unity
> 侧实现这 9 个"技能=真实函数"，执行完把结果发回 `/events` → `integrate`，
> 记忆/关系随之更新，形成 **感知→决策→执行→观察** 的完整闭环。技能盘外、或
> 超出 `groups` 限制的动作一律被拦，杜绝 LLM 凭空捏造不可执行的动作。

### 游戏引擎与 Vectra 的同步（消息方向）

同步分两条方向，机制不同：

| 方向 | 谁主动 | 用什么 | 时机 |
|------|--------|--------|------|
| 游戏 → Vectra | 游戏引擎 | `POST /events`（上报即反馈游标） | 游戏里发生任何事、或执行完一个技能后 |
| Vectra → 游戏 | Vectra | **`GET /worlds/{id}/stream`（SSE 长连接）** | NPC 自主决定行动时主动推送 |

**关键：NPC 行为是 Vectra 自主发起的，游戏没法"主动问"。** 所以 Vectra 内置一个
**自主决策泵**：把世界标为 `autonomous` 后，只要有游戏连着 `/stream` 订阅，它就按
`cadence`（秒）轮流让每个活跃 NPC `decide`，并把意图实时 `SSE` 推给游戏。没有订阅者
就不决策（省 token、不空转）。你只需在游戏侧用 Unity 的 `UnityWebRequest`/SSE 客户端
挂住这条流，收到 `npc.intent` 就执行对应技能。

```bash
# 打开自主模式（cadence=每个 NPC 每隔几秒想一次动）
curl -X PATCH $B/worlds/vale -H 'Content-Type: application/json' \
     -d '{"autonomous":true,"cadence":2}'
# 游戏侧长连接订阅（Unity C# 或任意 SSE 客户端），会不断收到：
#   event: npc.intent
#   data:  {"type":"npc.intent","world":"vale","ts":...,"who":"kid",
#           "goal":"...","need":"...","emotion":"...",
#           "action":{"skill":"talk_to","args":{"target":"p","prompt":"..."}},
#           "speech":"..."}
curl -N $B/worlds/vale/stream
```

> 你仍需在游戏里执行收到技能并回传结果（`POST /events`）。没有订阅者时 Vectra 不会
> 自主触发，避免了"无人执行还烧 token"的空转。

### 离线兜底（重要）
没有配 LLM Key 也能跑：整合/摘要/生成会走**确定性启发式**，结构与在线一致，
方便你离线测试、写单元测试、或在不想付 token 时跑轻量逻辑。配上任意
OpenAI 格式 LLM（DeepSeek/OpenAI/Ollama…）即升级为实时推理。

---

## 快速开始

```bash
# 1. 启动引擎（零依赖，只需 Python 3.8+）
python3 server.py                 # → http://127.0.0.1:8237/v1

# 2. 跑参考 demo（演示 Unity 侧完整调用链）
python3 samples/demo_client.py

# 3. 配置 LLM（可选，三种方式任一）
export VECTRA_LLM_ENDPOINT=https://api.deepseek.com/v1
export VECTRA_LLM_KEY=sk-xxx
export VECTRA_LLM_MODEL=deepseek-chat
```

### 一个最小调用序列（任意 HTTP 客户端）

```bash
B=http://127.0.0.1:8237/v1
# 注册世界
curl -X POST $B/worlds -H 'Content-Type: application/json' \
     -d '{"id":"vale","name":"风谷镇"}'
# 上报名册
curl -X PUT $B/worlds/vale/entities -H 'Content-Type: application/json' \
     -d '{"entities":[{"id":"kid","name":"孤儿"},{"id":"p","name":"旅人","kind":"player"}]}'
# 游戏事件：谁 对谁 做了什么 / 说了什么
curl -X POST $B/worlds/vale/events -H 'Content-Type: application/json' \
     -d '{"events":[{"time":"D1","actor":"kid","verb":"告诉","target":"p","text":"孤儿透露镇长夜里去旧矿洞。"}]}'
# 整合 → 摘要
curl -X POST $B/worlds/vale/integrate
curl -X POST $B/worlds/vale/summarize
# 拉取叙事 / 关系 / 生成
curl $B/worlds/vale/summary
curl $B/worlds/vale/graph
curl -X POST $B/worlds/vale/narrate -H 'Content-Type: application/json' -d '{"who":"kid"}'
# 让 NPC 自主决定下一步动作（可选 groups 限定技能类别）
curl -X POST $B/worlds/vale/decide -H 'Content-Type: application/json' \
     -d '{"who":"kid","groups":["move","social","item","combat"]}'
curl $B/worlds/vale/skills          # 查看技能清单
```

`openapi.yaml` 是完整契约，可直接导入 Postman / 生成 Unity C# 客户端。

---

## 事件格式（信息整合的输入）

游戏只需把"发生了什么"如实上报，叙事字段缺省留空即可：

```json
{
  "time": "D1 黄昏", "location": "港口",
  "actor": "cap",                 // 行为者(实体 id)
  "verb": "警告",                  // 规范化动词(驱动好感/信任启发)
  "target": "you",                // 对象(实体 id)
  "speaker": "cap",               // 若是对白行，谁开口
  "text": "雾里有东西，今晚别出航。",
  "payload": { "note": "...", "tone": "warm|neutral|hostile" }
}
```

---

## 配置

| 环境变量 | 默认 | 说明 |
|----------|------|------|
| `VECTRA_PORT` | `8237` | 端口 |
| `VECTRA_HOST` | `127.0.0.1` | 监听地址（游戏在别的机器可设 `0.0.0.0`） |
| `VECTRA_DATA` | `~/VectraData` | 数据目录（JSON 持久化） |
| `VECTRA_API_TOKEN` | 空 | 若设了，所有写操作需 `X-Vectra-Token` 头 |
| `VECTRA_LLM_ENDPOINT/_KEY/_MODEL` | — | 默认 LLM（OpenAI 格式） |

每个世界也可单独配 `PATCH /worlds/{id}` 里的 `llm`（endpoint/key/model/temperature）。

---

## 项目结构

```
Vectra/
├── server.py              # 无头叙事引擎入口（零依赖 HTTP + SSE）
├── vectra/
│   ├── __init__.py
│   ├── store.py           # 持久化 + 确定性逻辑（事件/记忆/事实/关系图/兜底大脑）
│   └── brain.py           # LLM 编排：信息整合 / 滚动摘要 / 剧情生成（含离线回退）
├── openapi.yaml           # REST 契约（游戏侧对接的唯一真源）
├── samples/
│   └── demo_client.py     # Unity 调用链参考 demo
└── docs / CHANGELOG
```

### 目录结构心智模型

每个世界 = `~/VectraData/worlds/<id>/` 下的一个目录：

```
world.json        # 设定(bible) + 玩家 + 实体名册 + 时钟 + LLM 配置 + 游标
events.jsonl      # 游戏上报的原始事件（只追加）
facts.jsonl       # 整合后的结构化事实
graph.json        # NPC 关系图（节点/边，revision 递增）
summary.json      # 滚动叙事摘要
memories/<eid>.mem.jsonl + .index.json   # 每个实体的记忆流 + 召回索引
```

数据通过游标（`cursors.ingested / integrated / summarized`）分段推进：
**事件 → 信息整合 → 摘要**，各段互不重复处理。

---

## 开发 / 测试

```bash
# 离线逻辑测试（无需服务器、无需 Key）
python3 - <<'PY'
from vectra.brain import NarrativeEngine
e = NarrativeEngine('/tmp/vd')
e.store.create_world('w', 'W')
# ... push events -> integrate(live=False) -> summarize(live=False)
PY
```

改 `server.py` 后直接重启即可，无构建链、无第三方依赖。

---

## 许可

MIT — VECTRA 2 · 让任何 2D 游戏都拥有一个会说故事的 AI 大脑。
