#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Reference client for the VECTRA narrative engine.

Zero-dependency (stdlib urllib) — mirrors exactly what a Unity/Godot C#
client does over HTTP. Run it with the engine up to see the full loop:
    create world -> push game events -> integrate -> summarize ->
    read graph -> narrate
"""
import json
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8237/v1'


def call(method, path, body=None):
    url = BASE + path
    req = urllib.request.Request(url, method=method)
    req.add_header('Content-Type', 'application/json')
    data = json.dumps(body).encode('utf-8') if body is not None else None
    with urllib.request.urlopen(req, data=data, timeout=20) as r:
        return json.loads(r.read().decode('utf-8')) if r.status != 204 else {}


def main():
    # 1. a game session registers a world
    call('POST', '/worlds', {
        'id': 'harbor', 'name': '雾港',
        'manifest': {'setting': {'lore': '被海雾笼罩的走私港'}},
    })

    # 2. roster of story entities (characters / player / factions)
    call('PUT', '/worlds/harbor/entities', {'entities': [
        {'id': 'cap', 'name': '老船长', 'kind': 'character', 'traits': ['狡黠']},
        {'id': 'girl', 'name': '铃', 'kind': 'character', 'desc': '船长的女儿'},
        {'id': 'you', 'name': '你', 'kind': 'player'},
    ]})

    # 3. the game reports what happened (as often as it likes)
    call('POST', '/worlds/harbor/events', {'events': [
        {'time': 'D1 黄昏', 'location': '港口', 'actor': 'cap', 'verb': '警告',
         'target': 'you', 'text': '老船长压低声音：雾里有东西，今晚别出航。'},
        {'time': 'D1 深夜', 'actor': 'girl', 'verb': '信任', 'target': 'you',
         'text': '铃塞给你一把生锈钥匙，求你别告诉父亲。'},
    ]})

    # 4. brain consolidates events into facts + per-NPC memory + relations
    call('POST', '/worlds/harbor/integrate')

    # 5. rolling narrative summary the game can feed to its UI / scene code
    call('POST', '/worlds/harbor/summarize')
    summary = call('GET', '/worlds/harbor/summary')
    print('\n—— 叙事摘要 ——\n' + summary['text'])

    # 6. NPC relationship graph for the game's relationship panel
    graph = call('GET', '/worlds/harbor/graph')
    print('\n—— 关系图 ({} nodes / {} edges) ——'.format(
        len(graph['nodes']), len(graph['edges'])))
    for e in graph['edges']:
        print('  {} ↔ {}  好感{:.2f} 熟悉{}'.format(
            e['a'], e['b'], e['affinity'], e['familiarity']))

    # 7. ask for a narration beat / dialogue line
    nar = call('POST', '/worlds/harbor/narrate',
               {'who': 'cap', 'prompt': '船长注意到你手里那把钥匙，一句意味深长的话'})
    print('\n—— 生成 ——\n' + nar.get('text', nar))


if __name__ == '__main__':
    main()
