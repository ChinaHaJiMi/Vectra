#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""VECTRA 2 — headless AI narrative engine (zero-dependency HTTP + SSE).

A game engine (Unity / Godot / Cocos / any HTTP client) drives this service:

    world = POST /v1/worlds                       # register a world + roster
    game  -> POST /v1/worlds/{id}/events          # report what just happened
    brain -> POST /v1/worlds/{id}/integrate       # facts + memory + relations
             POST /v1/worlds/{id}/summarize       # rolling narrative summary
    game  <- GET  /v1/worlds/{id}/summary         # 叙事摘要
             GET  /v1/worlds/{id}/graph           # NPC 关系图
             POST /v1/worlds/{id}/narrate         # narration / dialogue (SSE)
    game  <-- GET /v1/worlds/{id}/stream          # SSE subscribe: receive NPC
                                                   #   autonomous intents (push)
    brain ->  autonomous pump (per-world, cadence) decides NPCs & pushes them
              via /stream when a subscriber is connected; game executes the
              skill then reports the result back through POST /events.

Config:
    VECTRA_PORT   port (default 8237)
    VECTRA_HOST   bind host (default 127.0.0.1)
    VECTRA_DATA   data dir (default ~/VectraData)
    VECTRA_API_TOKEN   optional shared token required for write ops
    VECTRA_LLM_ENDPOINT / _KEY / _MODEL   default LLM (any OpenAI-format API)
"""
import json
import os
import re
import sys
import time
import queue
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vectra.brain import NarrativeEngine  # noqa: E402
from vectra.store import Store  # noqa: E402

PORT = int(os.environ.get('VECTRA_PORT', '8237'))
HOST = os.environ.get('VECTRA_HOST', '127.0.0.1')
DATA_DIR = os.environ.get('VECTRA_DATA',
                          os.path.join(os.path.expanduser('~'), 'VectraData'))
API_TOKEN = os.environ.get('VECTRA_API_TOKEN', '')
RATE = 1200  # req/min per IP


# ---------------------------------------------------------------------------
# SSE pub/sub hub — lets VECTRA PUSH events to subscribed game engines, the
# key channel for autonomous NPC behavior (a game can't "ask" for something
# Vectra decided on its own; Vectra must stream it out).
# ---------------------------------------------------------------------------
class _Hub:
    def __init__(self):
        self._subs = {}
        self._lock = threading.Lock()

    def subscribe(self, world):
        q = queue.Queue(maxsize=128)
        with self._lock:
            self._subs.setdefault(world, set()).add(q)
        return q

    def unsubscribe(self, world, q):
        with self._lock:
            s = self._subs.get(world)
            if s:
                s.discard(q)
                if not s:
                    self._subs.pop(world, None)

    def publish(self, world, payload):
        with self._lock:
            qs = list(self._subs.get(world, ()))
        for q in qs:
            try:
                q.put_nowait(payload)
            except queue.Full:
                pass  # slow consumer: drop rather than block the brain

    def n_subscribers(self, world):
        with self._lock:
            return len(self._subs.get(world, ()))


hub = _Hub()


def _now():
    return int(time.time() * 1000)


# Rate limiter (best-effort, not a security boundary)
_requests = {}


def _rate_ok(ip):
    now = time.time()
    win = now - 60.0
    _requests[ip] = [t for t in _requests.get(ip, []) if t > win]
    _requests[ip].append(now)
    if len(_requests) > 10000:
        for k in list(_requests):
            if not _requests[k]:
                del _requests[k]
    return len(_requests[ip]) <= RATE


class VectraHandler(BaseHTTPRequestHandler):
    server_version = 'VectraNarrative/2.0'
    engine = None
    token = API_TOKEN

    # -------------------------------------------------------------- plumbing
    def log_message(self, fmt, *args):
        sys.stderr.write('[vectra] %s\n' % (fmt % args))

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods',
                         'GET,POST,PUT,PATCH,DELETE,OPTIONS')
        self.send_header('Access-Control-Allow-Headers',
                         'Content-Type,Authorization,X-Vectra-Token')

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _send_stream(self, on_write):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache')
        self._cors()
        self.end_headers()
        on_write(self.wfile)

    def _error(self, status, msg):
        self._send_json({'error': msg}, status)

    def _read_body(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode('utf-8'))
        except ValueError:
            return {}
        return data if isinstance(data, (dict, list)) else {}

    def _path_parts(self):
        path = urllib.parse.urlsplit(self.path).path
        segs = [urllib.parse.unquote(s) for s in path.split('/') if s]
        return [s for s in segs if s]

    def _seg(self, parts, i):
        return parts[i] if i < len(parts) else None

    def _authorize_write(self):
        if self.token and self.headers.get('X-Vectra-Token') != self.token:
            self._error(401, 'missing or invalid X-Vectra-Token')
            return False
        return True

    # ------------------------------------------------------------- dispatch
    def _dispatch(self):
        if not _rate_ok(self.client_address[0]):
            self._error(429, 'rate limited')
            return
        parts = self._path_parts()
        m = self.command
        if not parts or parts[0] != 'v1':
            self._error(404, 'not found (namespace is /v1)')
            return
        p = parts[1:]
        # GET /v1/status
        if len(p) == 1 and p[0] == 'status' and m == 'GET':
            self._send_json(self._status_payload())
            return
        # GET /v1
        if not p and m == 'GET':
            self._send_json(self._status_payload())
            return
        if not p:
            self._error(404, 'not found'); return

        # --- worlds collection
        if p[0] == 'worlds' and len(p) == 1:
            if m == 'GET':
                self._send_json({'worlds': self.engine.store.list_worlds()})
            elif m == 'POST':
                if not self._authorize_write(): return
                b = self._read_body()
                try:
                    wid = self.engine.store.create_world(
                        b.get('id'), b.get('name'),
                        manifest=b.get('manifest'), llm=b.get('llm'))
                except FileExistsError as e:
                    self._error(409, str(e)); return
                self._send_json({'id': wid}, 201)
            else:
                self._error(405, 'method not allowed'); return
            return

        if p[0] == 'worlds' and len(p) >= 2:
            wid = p[1]
            self._world(p, wid, m)

        if p[0] == 'config' and len(p) == 1 and m == 'GET':
            self._send_json({'defaultLLM': bool(self.engine._cfg(None)['key'])})
            return

        self._error(404, 'not found')

    # ------------------------------------------------------------- world ops
    def _world(self, p, wid, m):
        st = self.engine.store
        if not st.exists(wid):
            self._error(404, f'world not found: {wid}')
            return
        if len(p) == 2:
            if m == 'GET':
                w = st.load_world(wid)
                self._send_json({k: w[k] for k in
                                 ('id', 'name', 'launched', 'autonomous',
                                  'cadence', 'clock', 'manifest', 'entities')
                                 if k in w})
            elif m == 'DELETE':
                if not self._authorize_write(): return
                st.delete_world(wid)
                self._send_json({'ok': True, 'deleted': wid})
            elif m == 'PATCH':
                if not self._authorize_write(): return
                b = self._read_body()
                if 'clock' in b:
                    st.set_clock(wid, b['clock'])
                if 'llm' in b:
                    self.engine.set_llm(wid, b['llm'])
                if 'launched' in b or 'autonomous' in b or 'cadence' in b:
                    w = st.load_world(wid)
                    if 'launched' in b:
                        w['launched'] = bool(b['launched'])
                    if 'autonomous' in b:
                        w['autonomous'] = bool(b['autonomous'])
                    if 'cadence' in b:
                        w['cadence'] = max(1, int(b['cadence'] or 5))
                    st.save_world(wid, w)
                self._send_json({'ok': True})
            else:
                self._error(405, 'method not allowed')
            return

        head = p[2]
        # ---- entity sub-resources / roster
        if head == 'entities':
            if len(p) == 3:
                if m == 'GET':
                    w = st.load_world(wid)
                    self._send_json({'entities': w['entities']})
                elif m == 'PUT':
                    if not self._authorize_write(): return
                    b = self._read_body()
                    lst = b.get('entities') or (b if isinstance(b, list) else [])
                    ent = st.upsert_entities(wid, lst)
                    self._send_json({'entities': ent, 'ok': True})
                else:
                    self._error(405, 'method not allowed')
            elif len(p) == 4:
                eid = p[3]
                w = st.load_world(wid)
                ent = st.entity(wid, eid)
                self._send_json({'entity': ent})
            elif len(p) == 5 and p[4] == 'memories':
                eid = p[3]
                if not st.entity(wid, eid):
                    self._error(404, f'entity not found: {eid}'); return
                if m == 'GET':
                    q = {'recent': int(self._q('recent', '8')),
                         'tags': self._q_list('tags')}
                    rec, idx = st.query_memory(wid, eid, q)
                    self._send_json({'entries': rec, 'index': idx})
                elif m == 'POST':
                    if not self._authorize_write(): return
                    b = self._read_body()
                    entries = b.get('entries') if isinstance(b, dict) else b
                    rows = st.append_memory(wid, eid, entries or [])
                    self._send_json({'added': len(rows), 'ok': True})
                elif m == 'PUT':
                    if not self._authorize_write(): return
                    b = self._read_body()
                    entries = b.get('entries') if isinstance(b, dict) else b
                    rows = st.overwrite_memory(wid, eid, entries or [])
                    self._send_json({'overwritten': len(rows), 'ok': True})
                else:
                    self._error(405, 'method not allowed')
            elif len(p) == 6 and p[4] == 'memories' and p[5] == 'query':
                if m != 'POST':
                    self._error(405, 'method not allowed'); return
                eid = p[3]
                b = self._read_body()
                rec, idx = st.query_memory(wid, eid, b)
                self._send_json({'matched': rec, 'index': idx})
            else:
                self._error(404, 'not found')
            return

        # ---- events
        if head == 'events' and len(p) == 3:
            if m == 'GET':
                after = int(self._q('after', '0'))
                limit = int(self._q('limit', '200'))
                evs = st.read_events(wid, after=after, limit=limit)
                w = st.load_world(wid)
                self._send_json({'events': evs,
                                 'cursor': w['cursors']['ingested']})
            elif m == 'POST':
                if not self._authorize_write(): return
                b = self._read_body()
                events = b.get('events') if isinstance(b, dict) else b
                if not isinstance(events, list):
                    self._error(400, 'body must be a list of events or {events:[]}')
                    return
                rows = st.append_events(wid, events)
                self._send_json({'added': len(rows), 'cursor': rows[-1]['seq'] if rows else 0},
                                201)
            else:
                self._error(405, 'method not allowed')
            return

        # ---- facts / summary / graph / integrate / narrate
        if head == 'facts' and len(p) == 3 and m == 'GET':
            self._send_json({'facts': st.read_facts(wid)}); return
        if head == 'summary' and len(p) == 3 and m == 'GET':
            self._send_json(st.load_summary(wid)); return
        if head == 'summarize' and len(p) == 3 and m == 'POST':
            if not self._authorize_write(): return
            r = self.engine.summarize(wid, live=True)
            self._send_json(r); return
        if head == 'integrate' and len(p) == 3 and m == 'POST':
            if not self._authorize_write(): return
            r = self.engine.integrate(wid, live=True)
            self._send_json(r); return
        if head == 'graph':
            if len(p) == 3 and m == 'GET':
                self._send_json(st.graph_for(wid)); return
            if len(p) == 4 and m == 'GET':
                self._send_json(st.graph_for(wid, p[3])); return
            if len(p) == 6 and p[3] == 'edges' and m == 'PUT':
                if not self._authorize_write(): return
                b = self._read_body()
                e = st.set_edge(wid, p[4], p[5], b)
                self._send_json({'edge': e, 'ok': True}); return
        if head == 'narrate' and len(p) == 3 and m == 'POST':
            if not self._authorize_write(): return
            spec = self._read_body()
            spec.setdefault('stream', False)
            out = self.engine.narrate(wid, spec, live=True)
            if out is None:
                self._error(404, 'world not found'); return
            if spec.get('stream') and hasattr(out, '__iter__') and not isinstance(out, dict):
                self._send_stream(lambda wf: self._pump_stream(out, wf))
            else:
                self._send_json(out)
            return
        if head == 'decide' and len(p) == 3 and m == 'POST':
            if not self._authorize_write(): return
            spec = self._read_body()
            out = self.engine.decide(wid, spec, live=True)
            if out is None:
                self._error(404, 'world not found'); return
            if isinstance(out, dict) and out.get('action', {}).get('skill'):
                hub.publish(wid, self._intent_payload(wid, out))
            self._send_json(out); return
        if head == 'skills' and len(p) == 3 and m == 'GET':
            spec = {'groups': self._q_list('groups')} or {}
            man = self.engine.skill_manifest(spec.get('groups') or None)
            self._send_json({'skills': man}); return
        if head == 'stream' and len(p) == 3 and m == 'GET':
            self._sse_loop(wid)
            return
        self._error(404, 'not found')

    # -------------------------------------------------------------- helpers
    def _status_payload(self):
        return {'ok': True, 'name': 'VECTRA narrative engine', 'version': 2,
                'onlineLLM': bool(self.engine._cfg(None)['key']) or self._has_world_llm(),
                'dataDir': DATA_DIR,
                'worlds': self.engine.store.list_worlds()}

    def _q(self, key, default):
        qs = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        return qs.get(key, [default])[0]

    def _q_list(self, key):
        qs = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        raw = qs.get(key, [])
        out = []
        for r in raw:
            out += [x for x in r.split(',') if x]
        return out

    def _has_world_llm(self):
        for w in self.engine.store.list_worlds():
            wd = self.engine.store.load_world(w['id'])
            if wd and wd.get('llm', {}).get('key'):
                return True
        return False

    def _pump_stream(self, gen, wf):
        try:
            for line in gen:
                s = line.strip()
                if s.startswith('data:'):
                    s = s[5:].strip()
                    try:
                        chunk = json.loads(s)
                        delta = ((chunk.get('choices') or [{}])[0]
                                 .get('delta') or {}).get('content', '')
                        if delta:
                            wf.write(b'data: ' + delta.encode('utf-8') + b'\n\n')
                            wf.flush()
                    except ValueError:
                        pass
            wf.write(b'data: [DONE]\n\n')
            wf.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    # ---- SSE subscribe loop: stream pushed events to one game engine -------
    @staticmethod
    def _frame(wf, event, data):
        payload = json.dumps(data, ensure_ascii=False).encode('utf-8')
        wf.write(b'event: ' + event.encode('utf-8') + b'\ndata: ' + payload + b'\n\n')
        wf.flush()

    @staticmethod
    def _intent_payload(world_id, decision):
        d = dict(decision)
        d.pop('online', None)
        return {'type': 'npc.intent', 'world': world_id, 'ts': _now(), **d}

    def _sse_loop(self, world_id):
        q = hub.subscribe(world_id)
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self._cors()
        self.end_headers()
        try:
            self._frame(self.wfile, 'ready', {'world': world_id,
                                              'subscribers': hub.n_subscribers(world_id)})
            while True:
                try:
                    item = q.get(timeout=15)
                except queue.Empty:
                    self.wfile.write(b': ping\n\n')
                    self.wfile.flush()
                    continue
                if item is None:
                    break
                self._frame(self.wfile, item.get('type', 'event'), item)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            hub.unsubscribe(world_id, q)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self): self._dispatch()
    def do_POST(self): self._dispatch()
    def do_PUT(self): self._dispatch()
    def do_PATCH(self): self._dispatch()
    def do_DELETE(self): self._dispatch()


# ---------------------------------------------------------------------------
# Autonomous pump — optional background thread. For worlds marked autonomous
# with at least one connected subscriber, decide for one active NPC every
# <cadence> seconds and PUSH the intent to the game over SSE. No subscriber,
# no decision (saves LLM tokens and avoids pointless work).
# ---------------------------------------------------------------------------
class _AutonomousPump(threading.Thread):
    def __init__(self, engine):
        super().__init__(daemon=True, name='vectra-autopump')
        self.engine = engine
        self.cursor = {}
        self._next = {}

    def _active_characters(self, world):
        return [e['id'] for e in world.get('entities', [])
                if e.get('kind') in ('character', None, '')]

    def run(self):
        while True:
            time.sleep(1.0)
            now = time.time()
            try:
                for meta in self.engine.store.list_worlds():
                    w = self.engine.store.load_world(meta['id'])
                    if not w or not w.get('autonomous'):
                        continue
                    if hub.n_subscribers(meta['id']) == 0:
                        self._next[meta['id']] = now  # wait until someone listens
                        continue
                    cadence = max(1, int(w.get('cadence', 5) or 5))
                    if now < self._next.get(meta['id'], 0):
                        continue
                    chars = self._active_characters(w)
                    if not chars:
                        continue
                    idx = self.cursor.get(meta['id'], 0) % len(chars)
                    self.cursor[meta['id']] = idx + 1
                    self._next[meta['id']] = now + cadence
                    who = chars[idx]
                    out = self.engine.decide(meta['id'], {'who': who}, live=True)
                    if isinstance(out, dict) and out.get('action', {}).get('skill'):
                        out.setdefault('who', who)
                        hub.publish(meta['id'], VectraHandler._intent_payload(meta['id'], out))
            except Exception as exc:  # never kill the pump
                sys.stderr.write('[vectra] autopump error: %s\n' % exc)


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    engine = NarrativeEngine(DATA_DIR)
    VectraHandler.engine = engine
    _AutonomousPump(engine).start()
    httpd = ThreadingHTTPServer((HOST, PORT), VectraHandler)
    print('=' * 54)
    print(f'  VECTRA 2 · headless AI narrative engine')
    print(f'  URL      http://{HOST}:{PORT}/v1')
    print(f'  Data     {DATA_DIR}')
    print(f'  LLM      {"configured" if engine._cfg(None)["key"] else "offline (deterministic)"}')
    print('=' * 54)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nstopped.')


if __name__ == '__main__':
    main()
