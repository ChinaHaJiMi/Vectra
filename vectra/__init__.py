"""VECTRA — headless AI narrative engine.

A zero-dependency Python narrative backend that any 2D game engine (Unity,
Godot, Cocos...) can talk to over REST/SSE.  It owns the "brain" layer:
world/entity state, a live event ledger, per-entity memory, a consolidated
fact store, rolling narrative summaries, and an NPC relationship graph.

The engine does NOT render the game.  The game reports what happened via
POST /events; Vectra integrates it into facts + relations + summaries and
answers GET /summary, GET /graph, GET /memories and POST /narrate.
"""

__version__ = "2.0.0"
__all__ = ["__version__"]
