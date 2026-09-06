"""Narrative orchestration for VECTRA.

Runs LLM-driven jobs — information integration, rolling summarization and
narration generation — over the store.  When no API key is configured the
engine transparently falls back to the deterministic brains in store.py, so
the whole REST surface works offline for testing and light uses.
"""
import json
import os
import urllib.request

from . import store as _store
from .store import Store

ENV_ENDPOINT = os.environ.get('VECTRA_LLM_ENDPOINT', 'https://api.deepseek.com/v1')
ENV_KEY = os.environ.get('VECTRA_LLM_KEY', '')
ENV_MODEL = os.environ.get('VECTRA_LLM_MODEL', 'deepseek-chat')

# ---------------------------------------------------------------------------
# Skill Manifest — the ONLY actions an NPC's decision may select.  The game
# engine implements each one as a real function; anything outside this list
# is rejected, so the LLM can never invent an un-runnable action.
# ---------------------------------------------------------------------------
SKILL_MANIFEST = [
    {'name': 'walk_to', 'group': 'move', 'desc': '移动到指定坐标',
     'args': {'x': 'number', 'y': 'number'}},
    {'name': 'look_at', 'group': 'move', 'desc': '看向某处/某实体',
     'args': {'focus': 'entityId'}},
    {'name': 'talk_to', 'group': 'social', 'desc': '对某实体说一句话',
     'args': {'target': 'entityId', 'prompt': 'string'}},
    {'name': 'pick_up', 'group': 'item', 'desc': '拾取一件物品',
     'args': {'item': 'entityId'}},
    {'name': 'give', 'group': 'item', 'desc': '把某件物品交给某实体',
     'args': {'item': 'entityId', 'to': 'entityId'}},
    {'name': 'use', 'group': 'item', 'desc': '使用一件物品/设施',
     'args': {'item': 'entityId'}},
    {'name': 'threaten', 'group': 'combat', 'desc': '威胁某实体',
     'args': {'target': 'entityId'}},
    {'name': 'attack', 'group': 'combat', 'desc': '攻击某实体',
     'args': {'target': 'entityId'}},
    {'name': 'flee', 'group': 'combat', 'desc': '逃离某处/某实体',
     'args': {'from': 'entityId'}},
]

HOSTILE_VERBS = {'攻击', '杀', '威胁', '侮辱', '欺骗', '背叛'}


class NarrativeEngine:
    def __init__(self, data_dir):
        self.store = Store(data_dir)

    # ------------------------------------------------------------------ config
    def _cfg(self, world):
        llm = (world or {}).get('llm') or {}
        endpoint = llm.get('endpoint') or ENV_ENDPOINT
        key = llm.get('key')
        if key is None:
            key = ENV_KEY
        model = llm.get('model') or ENV_MODEL
        temp = llm.get('temperature', 0.8)
        return {'endpoint': endpoint.rstrip('/'), 'key': key or '',
                'model': model, 'temperature': float(temp)}

    def _online(self, world):
        return bool(self._cfg(world)['key'])

    def set_llm(self, world_id, cfg):
        w = self.store.load_world(world_id)
        if not w:
            return None
        w['llm'] = {k: v for k, v in (cfg or {}).items()
                    if k in ('endpoint', 'key', 'model', 'temperature') and v != ''}
        self.store.save_world(world_id, w)
        return w['llm']

    # ------------------------------------------------------------------- HTTP
    def _chat(self, world, messages, json_mode=False, stream=False):
        cfg = self._cfg(world)
        url = cfg['endpoint'] + '/chat/completions'
        body = {
            'model': cfg['model'],
            'messages': messages,
            'temperature': cfg['temperature'],
            'stream': stream,
        }
        if json_mode:
            body['response_format'] = {'type': 'json_object'}
        req = urllib.request.Request(url, method='POST')
        req.add_header('Content-Type', 'application/json')
        if cfg['key']:
            req.add_header('Authorization', 'Bearer ' + cfg['key'])
        data = json.dumps(body).encode('utf-8')
        with urllib.request.urlopen(req, data=data, timeout=120) as resp:
            return json.loads(resp.read().decode('utf-8'))

    def _text_from(self, resp):
        try:
            return resp['choices'][0]['message']['content']
        except (KeyError, IndexError, TypeError):
            raise RuntimeError('LLM returned an unexpected payload')

    # ------------------------------------------------------------- context pack
    def _compact_entities(self, world):
        parts = []
        for e in world.get('entities', []):
            traits = '，'.join(e.get('traits', [])) or '—'
            parts.append(f"- {e['id']}（{e.get('name')}·{e.get('kind')}）："
                         f"{e.get('desc') or ''}；特质：{traits}")
        return '\n'.join(parts)

    def _compact_graph(self, world_id, limit=40):
        g = self.store.load_graph(world_id)
        lines = []
        for e in g['edges'][:limit]:
            a = next((n['name'] for n in g['nodes'] if n['id'] == e['a']), e['a'])
            b = next((n['name'] for n in g['nodes'] if n['id'] == e['b']), e['b'])
            lines.append(f"- {a} ↔ {b}：好感{e['affinity']:.2f} "
                         f"信任{e['trust']:.2f} 熟悉{e['familiarity']}")
        return '\n'.join(lines) or '（暂无关系记录）'

    def _compact_facts(self, world_id, limit=15):
        facts = self.store.read_facts(world_id, limit)
        return '\n'.join('- ' + f.get('content', '') for f in facts) or '（暂无）'

    # ------------------------------------------------------------ integration
    def integrate(self, world_id, live=True):
        """Read unsynced events, turn them into facts + memory + relation
        deltas, then advance the integration cursor."""
        w = self.store.load_world(world_id)
        if not w:
            return None
        cursor = w['cursors']['integrated']
        tail = self.store.read_events(world_id, after=cursor)
        if not tail:
            return {'processed': 0, 'cursor': cursor, 'online': False}
        ctx = {
            'events': tail,
            'roster': self._compact_entities(w),
            'graph': self._compact_graph(world_id),
            'known': self._compact_facts(world_id),
        }
        if live and self._online(w):
            result = self._integrate_llm(w, ctx)
        else:
            result = _store.integrate_deterministic(w, tail)
        return self._commit_integrate(world_id, w, tail, result)

    def _integrate_llm(self, world, ctx):
        prompt = (
            '你是游戏叙事引擎的"信息整合器"。读下面的最新事件，产出结构化结果：\n'
            '- 把事件凝练成事实（dedupe 已有 known）\n'
            '- 推断每对角色关系变化（affinity/trust 增量，范围-1~1）\n'
            '- 给每个涉及角色生成一条它会记住的记忆\n'
            '只返回 JSON：{"facts":[{"entities":[..],"content","importance"}],'
            '"relations":[{"a","b","affinity","trust","note"}],'
            '"memories":[{"entity","content","importance"}],"text":"一句话概述"}'
        )
        user = (f"角色清单：\n{ctx['roster']}\n\n当前关系：\n{ctx['graph']}"
                f"\n\n已知事实：\n{ctx['known']}"
                f"\n\n最新事件(JSON)：\n{json.dumps(ctx['events'], ensure_ascii=False)}")
        resp = self._chat(world, [{'role': 'system', 'content': prompt},
                                  {'role': 'user', 'content': user}], json_mode=True)
        try:
            return json.loads(self._text_from(resp))
        except (ValueError, RuntimeError):
            return _store.integrate_deterministic(world, ctx['events'])

    def _commit_integrate(self, world_id, world, tail, result):
        facts = result.get('facts') or []
        relations = result.get('relations') or []
        memories = result.get('memories') or []
        added_facts = self.store.append_facts(world_id, facts)
        rel = self.store.apply_relations(world_id, relations)
        mem_count = 0
        # deterministic path also feeds every involved entity a memory line
        if not memories:
            for f in added_facts:
                for ent in (f.get('entities') or []):
                    self.store.append_memory(world_id, ent, [{
                        'type': 'fact', 'tags': ['integrated', 'world'],
                        'content': f.get('content', ''), 'importance': 4,
                        'source': 'integrate'}])
                    mem_count += 1
        else:
            for m in memories:
                if m.get('entity'):
                    self.store.append_memory(world_id, m['entity'], [{
                        'type': 'fact', 'tags': ['integrated'],
                        'content': m.get('content', ''),
                        'importance': int(m.get('importance', 4)),
                        'source': 'integrate'}])
                    mem_count += 1
        w2 = self.store.load_world(world_id)
        w2['cursors']['integrated'] += len(tail)
        self.store.save_world(world_id, w2)
        return {'processed': len(tail), 'cursor': w2['cursors']['integrated'],
                'facts': len(added_facts), 'relations': rel,
                'memories': mem_count, 'online': bool(result.get('llm'))}

    # ---------------------------------------------------------------- summary
    def summarize(self, world_id, live=True):
        w = self.store.load_world(world_id)
        if not w:
            return None
        upto = w['cursors']['summarized']
        tail = self.store.read_events(world_id, after=upto, limit=400)
        old = self.store.load_summary(world_id)
        base = old.get('text', '') or ''
        if not tail:
            return {'processed': 0, 'online': False, 'summary': old}
        if live and self._online(w):
            text = self._summarize_llm(w, base, tail)
        else:
            text = _store.summarize_deterministic(w, tail, old)
        last_seq = tail[-1]['seq']
        self.store.save_summary(world_id, text, last_seq,
                                base_text=(old.get('baseText') or ''))
        return {'processed': len(tail), 'uptoSeq': last_seq,
                'online': bool(live and self._online(w)),
                'summary': self.store.load_summary(world_id)}

    def _summarize_llm(self, world, base, tail):
        tail_s = json.dumps(tail[-80:], ensure_ascii=False)
        prompt = ('你是游戏叙事引擎。把"已有故事摘要"和"新增事件"压缩成一段连贯的'
                  '滚动叙事摘要（保留关键人物、关系变化、悬念，忽略琐碎）。'
                  '直接输出纯文本，不要JSON。')
        user = f"已有摘要：\n{base or '（空）'}\n\n新增事件：\n{tail_s}"
        resp = self._chat(world, [{'role': 'system', 'content': prompt},
                                  {'role': 'user', 'content': user}])
        return self._text_from(resp)

    # ---------------------------------------------------------------- narrate
    def narrate(self, world_id, spec, live=True):
        """Generate a narrative beat / dialogue line. spec: {who, prompt,
        maxTokens, stream}. Returns {'text':...} or a streaming generator."""
        w = self.store.load_world(world_id)
        if not w:
            return None
        clock = w.get('clock', {})
        context_events = self.store.read_events(
            world_id, after=0, limit=40)[-6:]
        summary = self.store.load_summary(world_id).get('text', '')
        who = spec.get('who')
        recall = []
        if who:
            recall = self.store.query_memory(
                world_id, who, {'recent': 10, 'maxChars': 600})[0]
        stream = bool(spec.get('stream'))
        if live and self._online(w):
            return self._narrate_llm(w, spec, summary, context_events, recall,
                                     clock, stream)
        text = _store.narrate_deterministic(w, context_events, clock)
        return {'text': text, 'online': False}

    def _narrate_llm(self, world, spec, summary, context_events, recall, clock,
                     stream):
        system = ('你是游戏叙事引擎。根据给定的世界状态生成符合世界观的中文叙事/对白。'
                  '保持简洁，一句话或一段自然推进，不加解释。')
        player_role = (world.get('manifest') or {}).get('player', {}).get('desc', '')
        player = spec.get('who') or (world.get('manifest') or {}).get('player', {}).get('name') or '旁观者'
        piece = [
            f'时间：第{clock.get("day",1)}天 {clock.get("hour",9):02d}:{clock.get("minute",0):02d}',
            f'当前叙事摘要：{summary or "（尚未生成）"}',
            f'最近事件：{json.dumps(context_events[-3:], ensure_ascii=False)}',
        ]
        if recall:
            piece.append(f'{player}的记忆：\n' + '\n'.join('- ' + m.get('content', '') for m in recall))
        if player_role:
            piece.append(f'玩家身份：{player_role}')
        piece.append(f'生成视角/角色：{player}')
        piece.append(f'任务：{spec.get("prompt", "请自然地推进这段戏")}')
        messages = [{'role': 'system', 'content': system},
                    {'role': 'user', 'content': '\n'.join(piece)}]
        if not stream:
            resp = self._chat(world, messages)
            return {'text': self._text_from(resp), 'online': True}
        return self._stream(world, messages)

    def _stream(self, world, messages):
        """Generator yielding SSE text deltas (ndjson). Falls back to a single
        line on transport error."""
        cfg = self._cfg(world)
        url = cfg['endpoint'] + '/chat/completions'
        body = {'model': cfg['model'], 'messages': messages,
                'temperature': cfg['temperature'], 'stream': True}
        req = urllib.request.Request(url, method='POST')
        req.add_header('Content-Type', 'application/json')
        if cfg['key']:
            req.add_header('Authorization', 'Bearer ' + cfg['key'])
        try:
            with urllib.request.urlopen(req, data=json.dumps(body).encode('utf-8'),
                                        timeout=120) as resp:
                buf = ''
                while True:
                    chunk = resp.read(1)
                    if not chunk:
                        break
                    buf += chunk.decode('utf-8')
                    if buf.endswith('\n'):
                        yield buf.strip()
                        buf = ''
                if buf.strip():
                    yield buf.strip()
        except Exception:
            yield 'data: {"error":"stream failed"}'

    # ============================================================ DECIDE
    # The behavior brain: given an NPC's persona + memory + relations + the
    # live scene, return ONE structured intent whose .action.skill is always
    # drawn from SKILL_MANIFEST.  The game executes it; Vectra observes the
    # result back through /events -> integrate, closing the drive loop.
    # ============================================================
    def skill_manifest(self, groups=None):
        if not groups:
            return [dict(s) for s in SKILL_MANIFEST]
        allowed = set(groups)
        return [dict(s) for s in SKILL_MANIFEST if s['group'] in allowed]

    def decide(self, world_id, spec, live=True):
        w = self.store.load_world(world_id)
        if not w:
            return None
        groups = spec.get('groups')
        skills = self.skill_manifest(groups)
        if not skills:
            return {'error': 'no skills allowed by groups',
                    'action': {'skill': None}}
        valid = {s['name'] for s in skills}
        who = spec.get('who')
        # default subject: first non-player character
        if not who:
            who = self._first_npc(world_id)
        if not who:
            return {'error': 'no character entity to drive',
                    'action': {'skill': None}}
        if not self.store.entity(world_id, who):
            return {'error': f'entity not found: {who}'}

        ctx = self._decide_context(world_id, w, who, spec)
        online = bool(live and who and self._online(w))
        decision, coerced = None, False
        if online:
            decision = self._decide_llm(w, ctx, who, skills, spec)
            if decision and decision.get('action', {}).get('skill') not in valid:
                decision, coerced = None, True
        if not decision:
            decision = self._decide_offline(world_id, w, who, valid)
            decision['online'] = online
        if decision.get('action', {}).get('skill') not in valid:
            decision['action'] = {'skill': skills[0]['name'], 'args': {}}
            decision['coerced'] = True
        decision['who'] = who
        decision['skillGroups'] = groups
        decision['coerced'] = coerced or bool(decision.pop('coerced', False))
        return decision

    def _first_npc(self, world_id):
        w = self.store.load_world(world_id) or {}
        for e in w.get('entities', []):
            if e.get('kind') in ('character', None, ''):
                return e['id']
        return None

    def _entities_map(self, world):
        return {e['id']: e for e in world.get('entities', [])}

    def _decide_context(self, world_id, world, who, spec):
        emap = self._entities_map(world)
        rec, _ = self.store.query_memory(world_id, who,
                                         {'recent': 12, 'maxChars': 800})
        neigh = self.store.graph_for(world_id, who).get('relations', [])
        clock = world.get('clock', {})
        scene = self.store.read_events(world_id, after=0, limit=40)[-6:]
        return {'who': who, 'persona': emap.get(who),
                'roster': emap, 'memory': rec, 'relations': neigh,
                'clock': clock, 'scene': scene, 'prompt': spec.get('prompt', '')}

    def _manifest_line(self, skills):
        return '\n'.join(
            f"- {s['name']} ({s['group']}) {s['desc']} 参数:{s['args']}"
            for s in skills)

    def _decide_llm(self, world, ctx, who, skills, spec):
        lines = []
        p = ctx['persona']
        clock = ctx['clock']
        t = f'第{clock.get("day",1)}天 {clock.get("hour",9):02d}:{clock.get("minute",0):02d}'
        lines.append(f'世界时间：{t}')
        if p:
            lines.append(f'角色：{p.get("name")}（{p.get("kind")}）'
                         f' {p.get("desc") or ""}；特质：{"，".join(p.get("traits",[]))}')
        roster = ', '.join(f'{e["id"]}={e.get("name")}' for e in ctx['roster'].values())
        lines.append(f'在场实体：{roster or "（只有自己）"}')
        if ctx['relations']:
            rel_s = []
            for r in ctx['relations'][:10]:
                other = r['a'] if r['b'] == who else r['b']
                nm = ctx['roster'].get(other, {}).get('name', other)
                rel_s.append(f'{nm}(好感{r["affinity"]:.2f} 信任{r["trust"]:.2f})')
            lines.append('与我关系：' + '，'.join(rel_s))
        if ctx['memory']:
            lines.append('我的记忆：\n' + '\n'.join('- ' + m.get('content', '') for m in ctx['memory']))
        if ctx['scene']:
            lines.append('最近动静：' + json.dumps(ctx['scene'][-3:], ensure_ascii=False))
        prompt = (
            '你是这个 NPC 的"行为大脑"。此刻它在游戏中,请替它决定下一步真实动作。'
            '只能从下面技能清单里选一个 action.skill（先想清楚目标 goal 和当下需求 need，'
            '再选动作，最后给一句符合性格的 speech，可能为空）。'
            f'\n技能清单：\n{self._manifest_line(skills)}\n\n'
            f'附加要求（若有）：{ctx["prompt"] or "无"}'
            '只返回 JSON：'
            '{"goal":"长期目标","need":"当下驱动力","emotion":"此刻情绪",'
            '"action":{"skill":"上面清单之一","args":{"...":"按技能参数填实体id或坐标"}},'
            '"speech":"台词"}'
        )
        user = '\n'.join(lines)
        try:
            resp = self._chat(world, [{'role': 'system', 'content': prompt},
                                      {'role': 'user', 'content': user}],
                              json_mode=True)
            d = json.loads(self._text_from(resp))
        except (ValueError, RuntimeError):
            return None
        return d if isinstance(d, dict) else None

    def _first_skill(self, allowed, *names):
        for n in names:
            if n in allowed:
                return n
        return None

    def _decide_offline(self, world_id, world, who, allowed):
        """Deterministic intent so behavior works with no LLM key. Picks only
        skills present in the allowed set (honours group restrictions)."""
        emap = self._entities_map(world)
        rela = self.store.graph_for(world_id, who).get('relations', [])
        scene = self.store.read_events(world_id, after=0, limit=40)[-10:]

        def resolve(rel):
            return rel['a'] if rel['b'] == who else rel['b']

        # 1) being attacked/threatened right now -> react within allowed skills
        for ev in scene:
            if ev.get('target') == who and ev.get('verb') in HOSTILE_VERBS:
                actor = ev.get('actor', '')
                pick = self._first_skill(allowed, 'flee', 'threaten', 'talk_to')
                if pick == 'flee':
                    act, emo, sp = {'skill': 'flee', 'args': {'from': actor}}, \
                        '惊惧', '不好，得先走！'
                elif pick == 'threaten':
                    act, emo, sp = {'skill': 'threaten', 'args': {'target': actor}}, \
                        '愤怒', '别乱来，我不是吃素的。'
                elif pick == 'talk_to':
                    act, emo, sp = {'skill': 'talk_to',
                                    'args': {'target': actor, 'prompt': '为何动我？'}}, \
                        '警惕', '放下刀，把话说清楚。'
                else:
                    continue
                return {'goal': '自保', 'need': 'safety', 'emotion': emo,
                        'action': act, 'speech': sp}
        # 2) strongest living relation drives the mood
        if rela:
            rel = max(rela, key=lambda r: abs(r.get('affinity', 0)))
            other = resolve(rel)
            other_name = emap.get(other, {}).get('name', other)
            aff = rel.get('affinity', 0.0)
            if aff <= -0.3:
                pick = self._first_skill(allowed, 'talk_to', 'threaten', 'flee',
                                         'look_at')
                if pick == 'talk_to':
                    act, emo, sp = ({'skill': 'talk_to',
                                     'args': {'target': other,
                                              'prompt': '你最近为何与我为敌？'}},
                                    '警觉', f'{other_name}，有话直说。')
                elif pick == 'threaten':
                    act, emo, sp = ({'skill': 'threaten',
                                     'args': {'target': other}}, '敌意',
                                    f'{other_name}，别逼我。')
                elif pick == 'flee':
                    act, emo, sp = ({'skill': 'flee',
                                     'args': {'from': other}}, '不安',
                                    '离他远点。')
                else:
                    act, emo, sp = ({'skill': 'look_at',
                                     'args': {'focus': other}}, '警觉', '')
                return {'goal': '化解敌意', 'need': 'safety', 'emotion': emo,
                        'action': act, 'speech': sp}
            if aff >= 0.2:
                pick = self._first_skill(allowed, 'talk_to', 'look_at')
                if pick == 'talk_to':
                    return {'goal': '维系关系', 'need': 'companionship',
                            'emotion': '友善',
                            'action': {'skill': 'talk_to',
                                       'args': {'target': other,
                                                'prompt': '一起喝一杯，聊聊近况。'}},
                            'speech': f'{other_name}，来坐坐。'}
                return {'goal': '留意故人', 'need': 'companionship',
                        'emotion': '平静',
                        'action': {'skill': 'look_at', 'args': {'focus': other}},
                        'speech': ''}
        # 3) ambient idle within allowed skills
        pick = self._first_skill(allowed, 'talk_to', 'look_at', 'walk_to')
        if pick == 'talk_to':
            target = None
            for e in world.get('entities', []):
                if e['id'] != who:
                    target = e['id']
                    break
            if target:
                return {'goal': '照常度日', 'need': 'routine', 'emotion': '平静',
                        'action': {'skill': 'talk_to',
                                   'args': {'target': target, 'prompt': '随便聊聊。'}},
                        'speech': '最近可好？'}
        if pick == 'walk_to':
            return {'goal': '照常度日', 'need': 'routine', 'emotion': '平静',
                    'action': {'skill': 'walk_to', 'args': {'x': 0, 'y': 0}},
                    'speech': ''}
        return {'goal': '照常度日', 'need': 'routine', 'emotion': '平静',
                'action': {'skill': 'look_at', 'args': {'focus': 'nearby'}},
                'speech': ''}

