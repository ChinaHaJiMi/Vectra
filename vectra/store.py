"""Persistence + pure-logic core of the VECTRA narrative engine.

Everything here is standard-library only and deterministic (no LLM).  The
LLM-dependent orchestration lives in vectra/brain.py and *always* has an
offline fallback into the deterministic functions defined in this module, so
the engine stays testable and functional with no API key configured.
"""
import json
import os
import re
import time

IDENT_RE = re.compile(r'[^\w\-\u4e00-\u9fff]+')  # keep word chars / dashes / CJK

DEFAULT_IMPORTANCE = 4


def safe_segment(name, fallback="item"):
    """Sanitize a world/entity id into a safe filesystem segment."""
    s = IDENT_RE.sub('_', str(name or '')).strip('_')
    if not s or s in ('.', '..'):
        return fallback
    return s[:64]


def _now():
    return int(time.time() * 1000)


def _pair_key(a, b):
    return '::'.join(sorted((str(a), str(b))))


# ---------------------------------------------------------------------------
# Low-level file helpers (same security posture as the old server)
# ---------------------------------------------------------------------------
def _json_load(path, default):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, ValueError, OSError):
        return default


def _json_dump(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _read_jsonl(path):
    out = []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        out.append(json.loads(line))
                    except ValueError:
                        continue
    except OSError:
        pass
    return out


def _append_jsonl(path, items):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'a', encoding='utf-8') as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + '\n')


def _write_jsonl(path, items):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + '\n')


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------
class Store:
    def __init__(self, data_dir):
        self.root = data_dir
        self.worlds_dir = os.path.join(data_dir, 'worlds')
        os.makedirs(self.worlds_dir, exist_ok=True)

    # -- path resolution ------------------------------------------------------
    def _wid(self, world_id):
        return safe_segment(world_id, 'world')

    def _wdir(self, world_id):
        return os.path.join(self.worlds_dir, self._wid(world_id))

    def _file(self, world_id, name):
        return os.path.join(self._wdir(world_id), name)

    def _mem_path(self, world_id, eid, kind):
        eid_s = safe_segment(eid, 'ent')
        d = os.path.join(self._wdir(world_id), 'memories')
        return os.path.join(d, f'{eid_s}.{kind}')

    # -- worlds ---------------------------------------------------------------
    def list_worlds(self):
        out = []
        if os.path.isdir(self.worlds_dir):
            for d in sorted(os.listdir(self.worlds_dir)):
                wf = os.path.join(self.worlds_dir, d, 'world.json')
                if os.path.exists(wf):
                    w = _json_load(wf, None)
                    if w:
                        out.append({'id': d, 'name': w.get('name', d),
                                    'launched': bool(w.get('launched')),
                                    'entityCount': len(w.get('entities', []))})
        return out

    def exists(self, world_id):
        return os.path.isfile(self._file(world_id, 'world.json'))

    def load_world(self, world_id):
        w = _json_load(self._file(world_id, 'world.json'), None)
        return w

    def save_world(self, world_id, world):
        world['updatedAt'] = _now()
        _json_dump(self._file(world_id, 'world.json'), world)

    def create_world(self, world_id, name, manifest=None, llm=None):
        wid = self._wid(world_id)
        if os.path.isdir(self._wdir(wid)) and self.exists(wid):
            raise FileExistsError(f'world already exists: {wid}')
        world = {
            'id': wid, 'name': name or wid,
            'launched': False,
            'clock': {'day': 1, 'hour': 9, 'minute': 0},
            'manifest': manifest or {'setting': {}, 'player': {}},
            'entities': [],
            'cursors': {'ingested': 0, 'integrated': 0, 'summarized': 0},
            'llm': llm or {},
            'createdAt': _now(),
        }
        self.save_world(wid, world)
        self._write_graph(wid, {'nodes': [], 'edges': [], 'revision': 0})
        self._write_summary(wid, {'text': '', 'baseText': '',
                                  'updatedAt': _now(), 'revision': 0})
        return wid

    def delete_world(self, world_id):
        import shutil
        d = self._wdir(world_id)
        if os.path.isdir(d):
            shutil.rmtree(d, ignore_errors=True)
            return True
        return False

    def set_clock(self, world_id, clock):
        w = self.load_world(world_id)
        if not w:
            return None
        for k in ('day', 'hour', 'minute'):
            if k in clock:
                w['clock'][k] = int(clock[k])
        self.save_world(world_id, w)
        return w['clock']

    # -- entities -------------------------------------------------------------
    def upsert_entities(self, world_id, entities):
        w = self.load_world(world_id)
        if not w:
            return None
        by_id = {e['id']: e for e in w['entities']}
        for e in entities:
            e.setdefault('kind', 'character')
            e.setdefault('traits', [])
            e.setdefault('speech', {'style': '', 'tic': ''})
            e.setdefault('active', True)
            by_id[e['id']] = e
        w['entities'] = list(by_id.values())
        self.save_world(world_id, w)
        self.sync_graph(world_id)
        return w['entities']

    def entity(self, world_id, eid):
        w = self.load_world(world_id)
        if not w:
            return None
        for e in w['entities']:
            if e['id'] == eid:
                return e
        return None

    # -- events ---------------------------------------------------------------
    def _events_total(self, world_id):
        w = self.load_world(world_id)
        return (w or {}).get('cursors', {}).get('ingested', 0)

    def append_events(self, world_id, events):
        """Append events, assign monotonically increasing seq. Returns added."""
        w = self.load_world(world_id)
        if not w:
            return None
        start = w['cursors']['ingested']
        ts = _now()
        rows = []
        for i, ev in enumerate(events):
            seq = start + i + 1
            rows.append({
                'seq': seq, 'ts': ts + i,
                'type': ev.get('type', 'act'),
                'time': ev.get('time', ''),
                'location': ev.get('location', ''),
                'actor': ev.get('actor', ''),
                'verb': ev.get('verb', ''),
                'target': ev.get('target', ''),
                'speaker': ev.get('speaker', ''),
                'text': ev.get('text', ''),
                'payload': ev.get('payload', {}),
            })
        w['cursors']['ingested'] = start + len(rows)
        self.save_world(world_id, w)
        _append_jsonl(self._file(world_id, 'events.jsonl'), rows)
        return rows

    def read_events(self, world_id, after=0, limit=200):
        events = _read_jsonl(self._file(world_id, 'events.jsonl'))
        return [e for e in events if e['seq'] > after][:limit]

    # -- facts ----------------------------------------------------------------
    def append_facts(self, world_id, facts):
        facts = [dict(f) for f in facts]
        for i, f in enumerate(facts):
            f.setdefault('id', f'f{_now()}{i}')
            f.setdefault('importance', DEFAULT_IMPORTANCE)
            f.setdefault('ts', _now())
        _append_jsonl(self._file(world_id, 'facts.jsonl'), facts)
        return facts

    def read_facts(self, world_id, limit=500):
        return _read_jsonl(self._file(world_id, 'facts.jsonl'))[-limit:]

    # -- graph ----------------------------------------------------------------
    def _graph_path(self, world_id):
        return self._file(world_id, 'graph.json')

    def _read_graph(self, world_id):
        return _json_load(self._graph_path(world_id),
                          {'nodes': [], 'edges': [], 'revision': 0})

    def _write_graph(self, world_id, g):
        g['updatedAt'] = _now()
        _json_dump(self._graph_path(world_id), g)

    def load_graph(self, world_id):
        g = self._read_graph(world_id)
        self.sync_graph(world_id)
        return self._read_graph(world_id)

    def sync_graph(self, world_id):
        """Mirror the entity roster as graph nodes."""
        w = self.load_world(world_id)
        if not w:
            return None
        g = self._read_graph(world_id)
        node_map = {n['id']: n for n in g['nodes']}
        for e in w['entities']:
            node_map[e['id']] = {
                'id': e['id'], 'name': e.get('name', e['id']),
                'kind': e.get('kind', 'character'), 'desc': e.get('desc', ''),
            }
        g['nodes'] = list(node_map.values())
        self._write_graph(world_id, g)
        return g

    def apply_relations(self, world_id, deltas):
        """Merge relationship deltas [{a,b,affinity,trust,note,eventSeq}] into
        the graph, summing numeric deltas per involved pair. Called after each
        integration batch; deltas are accumulators returned by the LLM."""
        g = self._read_graph(world_id)
        edges = {e['_pk']: e for e in g['edges'] if '_pk' in e}
        for d in deltas or []:
            a, b = str(d.get('a')), str(d.get('b'))
            if not a or not b or a == b:
                continue
            pk = _pair_key(a, b)
            ed = edges.get(pk)
            if ed is None:
                ed = {'a': a, 'b': b, '_pk': pk, 'affinity': 0.0,
                      'trust': 0.0, 'familiarity': 0, 'summary': '',
                      'lastSeq': 0}
                edges[pk] = ed
            def _delta(k):
                v = d.get(k)
                try:
                    return float(v)
                except (TypeError, ValueError):
                    return 0.0
            ed['affinity'] = max(-1.0, min(1.0, ed['affinity'] + _delta('affinity')))
            ed['trust'] = max(-1.0, min(1.0, ed['trust'] + _delta('trust')))
            if _delta('familiarity') or ed['familiarity'] == 0:
                ed['familiarity'] += int(_delta('familiarity'))
            if d.get('note'):
                ed['summary'] = str(d['note'])
            if d.get('eventSeq'):
                ed['lastSeq'] = max(ed.get('lastSeq', 0), int(d['eventSeq']))
        g['edges'] = [v for v in edges.values()]
        g['revision'] = g.get('revision', 0) + 1
        self._write_graph(world_id, g)
        return {'edges': len(g['edges']), 'revision': g['revision']}

    def graph_for(self, world_id, eid=None):
        g = self.load_graph(world_id)
        if eid:
            node = next((n for n in g['nodes'] if n['id'] == eid), None)
            rels = [e for e in g['edges'] if eid in (e['a'], e['b'])]
            return {'node': node, 'relations': rels}
        return g

    def set_edge(self, world_id, a, b, fields):
        g = self._read_graph(world_id)
        pk = _pair_key(a, b)
        edge = None
        for e in g['edges']:
            if e.get('_pk') == pk:
                edge = e
                break
        if edge is None:
            edge = {'a': a, 'b': b, '_pk': pk, 'affinity': 0.0, 'trust': 0.0,
                    'familiarity': 0, 'summary': '', 'lastSeq': 0}
            g['edges'].append(edge)
        for k in ('affinity', 'trust', 'familiarity', 'summary'):
            if k in fields:
                edge[k] = fields[k]
        self._write_graph(world_id, g)
        return edge

    # -- narrative summary ----------------------------------------------------
    def _summary_path(self, world_id):
        return self._file(world_id, 'summary.json')

    def _read_summary(self, world_id):
        return _json_load(self._summary_path(world_id),
                          {'text': '', 'baseText': '', 'updatedAt': _now(),
                           'revision': 0})

    def _write_summary(self, world_id, s):
        s['updatedAt'] = _now()
        _json_dump(self._summary_path(world_id), s)

    def load_summary(self, world_id):
        return self._read_summary(world_id)

    def save_summary(self, world_id, text, upto_seq, base_text=''):
        s = self._read_summary(world_id)
        w = self.load_world(world_id)
        if w is not None:
            w['cursors']['summarized'] = max(w['cursors'].get('summarized', 0), upto_seq)
            self.save_world(world_id, w)
        s.update({'text': text, 'baseText': base_text or s.get('baseText', ''),
                  'revision': s.get('revision', 0) + 1, 'uptoSeq': upto_seq})
        self._write_summary(world_id, s)
        return s

    # -- per-entity memory (reuses the JSONL + index model) --------------------
    def memory_entries(self, world_id, eid):
        return _read_jsonl(self._mem_path(world_id, eid, 'mem.jsonl'))

    def append_memory(self, world_id, eid, entries):
        rows = []
        ts = _now()
        for i, en in enumerate(entries):
            rows.append({
                'id': en.get('id') or f'm{ts}{i}',
                'ts': ts + i,
                'type': en.get('type', 'observation'),
                'tags': list(en.get('tags', []) or []),
                'content': en.get('content', ''),
                'importance': int(en.get('importance', DEFAULT_IMPORTANCE)),
                'source': en.get('source', 'engine'),
            })
        _append_jsonl(self._mem_path(world_id, eid, 'mem.jsonl'), rows)
        self._rebuild_index(world_id, eid)
        return rows

    def overwrite_memory(self, world_id, eid, entries):
        rows = []
        for i, en in enumerate(entries):
            rows.append({
                'id': en.get('id') or f'm{_now()}{i}',
                'ts': en.get('ts', _now() + i),
                'type': en.get('type', 'observation'),
                'tags': list(en.get('tags', []) or []),
                'content': en.get('content', ''),
                'importance': int(en.get('importance', DEFAULT_IMPORTANCE)),
                'source': en.get('source', 'engine'),
            })
        _write_jsonl(self._mem_path(world_id, eid, 'mem.jsonl'), rows)
        self._rebuild_index(world_id, eid)
        return rows

    def _rebuild_index(self, world_id, eid):
        entries = self.memory_entries(world_id, eid)
        idx = {'byTag': {}, 'byTime': [], 'byImportance': {}, 'total': len(entries)}
        for e in entries:
            idx['byTime'].append(e['id'])
            for t in e.get('tags', []):
                idx['byTag'].setdefault(t, []).append(e['id'])
            lvl = e.get('importance', 0)
            idx['byImportance'].setdefault(str(lvl), []).append(e['id'])
        _json_dump(self._mem_path(world_id, eid, 'index.json'), idx)
        return idx

    def query_memory(self, world_id, eid, q):
        """Recall memory entries by tag / importance / recency weight."""
        entries = self.memory_entries(world_id, eid)
        idx = _json_load(self._mem_path(world_id, eid, 'index.json'), {})
        want_tags = set(q.get('tags', []) or [])
        min_imp = int(q.get('minImportance', 0))
        recent = int(q.get('recent', 8))
        by_time = idx.get('byTime', [])
        by_tag = idx.get('byTag', {})
        by_imp = idx.get('byImportance', {})
        scored = {}
        for i, eid_ in enumerate(by_time[:recent]):
            scored[eid_] = scored.get(eid_, 0) + 1.0 - i * 0.1
        for t in want_tags:
            for eid_ in by_tag.get(t, []):
                scored[eid_] = scored.get(eid_, 0) + 1.5
        for lvl_s, ids_ in by_imp.items():
            try:
                if int(lvl_s) >= max(7, min_imp):
                    for eid_ in ids_:
                        scored[eid_] = scored.get(eid_, 0) + 1.2
            except ValueError:
                pass
        emap = {e['id']: e for e in entries}
        ordered = sorted(scored, key=lambda x: scored[x], reverse=True)
        max_chars = int(q.get('maxChars', 1200))
        out, used = [], 0
        for eid_ in ordered:
            e = emap.get(eid_)
            if not e:
                continue
            c = e.get('content', '')
            if used + len(c) > max_chars:
                continue
            out.append(e)
            used += len(c)
        return out, idx


# ---------------------------------------------------------------------------
# Deterministic brains — offline fallbacks, always available.
# ---------------------------------------------------------------------------
VERB_AFFINITY = {
    '帮助': 0.25, '救': 0.3, '赠': 0.2, '请': 0.2, '夸奖': 0.2, '承诺': 0.15,
    '分享': 0.15, '安慰': 0.2, '信任': 0.25, '合作': 0.15,
    '争吵': -0.2, '偷': -0.25, '攻击': -0.3, '杀': -0.4, '背叛': -0.35,
    '欺骗': -0.25, '威胁': -0.25, '侮辱': -0.2, '拒绝': -0.1, '怀疑': -0.1,
}


def integrate_deterministic(world, events):
    """Heuristic integrate: emit one fact + relation deltas per interaction
    event. Mirror output shape of the LLM path so handlers are identical."""
    rel_deltas, facts = [], []
    for ev in events:
        actor, target = ev.get('actor'), ev.get('target')
        text = ev.get('text') or ''
        verb = ev.get('verb') or ''
        payload = ev.get('payload') or {}
        involved = [x for x in (actor, target) if x]
        desc = text or payload.get('note') or f'{actor} {verb} {target}'
        facts.append({'entities': involved, 'type': 'event',
                      'content': f'[{ev.get("time","")}] {desc}',
                      'importance': 4, 'source': 'integrate',
                      'eventSeq': ev.get('seq')})
        if actor and target and actor != target:
            da = VERB_AFFINITY.get(verb, 0.0)
            if payload.get('tone') == 'hostile':
                da -= 0.15
            if payload.get('tone') == 'warm':
                da += 0.15
            rel_deltas.append({'a': actor, 'b': target,
                               'affinity': da, 'trust': da * 0.5,
                               'familiarity': 1, 'note': desc[:60],
                               'eventSeq': ev.get('seq')})
    return {'relations': rel_deltas, 'facts': facts,
            'text': '\n'.join(f['content'] for f in facts)}


def summarize_deterministic(world, tail_events, old_summary, max_chars=1600):
    """Offline rolling summary: append tail lines onto a cap."""
    base = (old_summary or {}).get('text', '') or ''
    lines = []
    for ev in tail_events:
        note = (ev.get('payload') or {}).get('note') or ev.get('text') or ''
        who = ev.get('speaker') or ev.get('actor') or '？'
        t = ev.get('time') or f'D{world.get("clock",{}).get("day",1)}'
        if note:
            lines.append(f'[{t}] {who}：{note}')
    joined = '\n'.join(lines)
    merged = (base + '\n' + joined).strip() if base else joined
    if len(merged) > max_chars:
        merged = merged[-max_chars:]
    return merged


def narrate_deterministic(world, events, clock):
    lines = []
    for ev in (events or [])[-3:]:
        who = ev.get('speaker') or ev.get('actor') or '？'
        note = (ev.get('payload') or {}).get('note') or ev.get('text') or \
               f'{ev.get("actor")} {ev.get("verb")} {ev.get("target")}'.strip()
        lines.append(f'{who}：{note}')
    where = (events or [{}])[-1].get('location') or '此地'
    clock_s = f'第{clock.get("day",1)}天 {clock.get("hour",9):02d}:{clock.get("minute",0):02d}'
    if not lines:
        return f'（{clock_s}，{where}一片平静。）'
    return f'（{clock_s} · {where}）' + ' '.join(lines)
