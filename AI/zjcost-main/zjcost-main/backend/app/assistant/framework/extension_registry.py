"""ExtensionRegistry — central registry for domain-knowledge Extensions (Phase H4).

Singleton-friendly: import the module-level ``extension_registry`` instance.

## Usage

```python
from app.assistant.framework.extension_registry import extension_registry, load_extensions_from_dir

# Load all skills from a directory (e.g. at app startup)
skills = load_extensions_from_dir("app/assistant/extensions", strict=False)
for s in skills:
    extension_registry.register(s)

# Look up by name
hksmm = extension_registry.get("hksmm4_basics")

# Match by trigger keywords in a query
active = extension_registry.match(query="HKSMM4 计量规则", context={"region": "HK"})
```
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

from app.assistant.framework.extension import Extension, ExtensionParseError, parse_extension_file

logger = logging.getLogger(__name__)


# ───────────────────────────────────────────────────────────────────
# ExtensionRegistry
# ───────────────────────────────────────────────────────────────────


class ExtensionRegistry:
    """Central registry for all domain-knowledge Extensions."""

    def __init__(self) -> None:
        self._skills: dict[str, Extension] = {}

    # ── Registration ──

    def register(self, skill: Extension) -> None:
        """Register a skill. Overwrites any prior registration for the same name."""
        if not skill.name:
            raise ValueError("cannot register skill with empty name")
        if skill.name in self._skills:
            logger.debug("Extension '%s' re-registered, replacing prior entry", skill.name)
        self._skills[skill.name] = skill

    def register_many(self, *skills: Extension) -> None:
        for s in skills:
            self.register(s)

    def clear(self) -> None:
        """Remove all registered skills (mostly useful in tests)."""
        self._skills.clear()

    # ── Lookup ──

    def get(self, name: str) -> Extension | None:
        return self._skills.get(name)

    def has(self, name: str) -> bool:
        return name in self._skills

    def all_names(self) -> list[str]:
        return sorted(self._skills.keys())

    def all_skills(self) -> list[Extension]:
        return list(self._skills.values())

    def all_extensions(self) -> list[Extension]:
        return self.all_skills()

    def __len__(self) -> int:
        return len(self._skills)

    def __contains__(self, name: str) -> bool:
        return name in self._skills

    # ── Selection helpers ──

    def get_many(self, names: list[str], *, strict: bool = False) -> list[Extension]:
        """Look up multiple skills by name.

        Args:
            names: list of skill names to look up.
            strict: If True, raise KeyError on any missing name; otherwise skip.
        """
        out: list[Extension] = []
        for n in names:
            s = self._skills.get(n)
            if s is None:
                if strict:
                    raise KeyError(f"skill not found: {n}")
                logger.warning("Extension not found (skipped): %s", n)
                continue
            out.append(s)
        return out

    # ── Semantic matching (Phase H5) ──

    def match_semantic(
        self,
        *,
        query: str,
        limit: int = 5,
        min_similarity: float = 0.0,
        provider: Any = None,
    ) -> list[tuple[float, Extension]]:
        """Embedding-based skill matching.

        Returns (similarity, skill) pairs sorted by similarity descending.

        Embedding corpus per skill = title + description + "\n" + triggers
        (not the full body, keeping vector focused on metadata intent).

        Vectors are cached per-provider on the skill instance to avoid
        recomputation across queries.
        """
        from app.assistant.framework.embed_provider import get_embed_provider
        from app.assistant.framework.vector_utils import dot, top_k

        if not query or not self._skills:
            return []

        emb = provider or get_embed_provider()
        cache_key = f"_emb_cache::{emb.name}"

        skills = list(self._skills.values())

        # Compute (or reuse cached) vectors for each skill.
        for s in skills:
            if getattr(s, cache_key, None) is None:
                corpus = self._extension_corpus(s)
                s.__dict__[cache_key] = emb.embed(corpus)

        q_vec = emb.embed(query)
        scored = [
            (dot(q_vec, s.__dict__[cache_key]), s)
            for s in skills
        ]
        return top_k(scored, limit, min_score=min_similarity)

    @staticmethod
    def _extension_corpus(skill: Extension) -> str:
        """Text blob used to embed a skill for semantic matching."""
        parts = [skill.title, skill.description]
        if skill.triggers:
            parts.append(" ".join(skill.triggers))
        if skill.tags:
            parts.append(" ".join(skill.tags))
        return "\n".join(p for p in parts if p)

    # ── Matching ──

    def match(
        self,
        *,
        query: str | None = None,
        context: dict[str, Any] | None = None,
        tags: list[str] | None = None,
    ) -> list[Extension]:
        """Find skills whose triggers/context/tags match the given inputs.

        All provided criteria must match (AND semantics).
        If a criterion is None/empty, it's ignored.

        Returns skills sorted alphabetically by name for stable output.
        """
        out: list[Extension] = []
        ctx_attrs = context or {}
        tag_set = set(tags or [])

        for skill in self._skills.values():
            if query is not None and not skill.matches_query(query):
                continue
            if ctx_attrs and not skill.matches_context(ctx_attrs):
                continue
            if tag_set and not tag_set.issubset(set(skill.tags)):
                continue
            out.append(skill)

        out.sort(key=lambda s: s.name)
        return out


# ───────────────────────────────────────────────────────────────────
# Directory loader
# ───────────────────────────────────────────────────────────────────


_SNAKE_CASE_RE = re.compile(r"^[a-z][a-z0-9_]*\.md$")


def load_extensions_from_dir(
    directory: Path | str,
    *,
    strict: bool = False,
) -> list[Extension]:
    """Load all `.md` skill files from a directory.

    Mirrors load_agents_from_dir's conventions:
    - Only files matching snake_case.md are loaded.
    - README.md and non-matching files are skipped.
    - If strict=True, parse errors raise; otherwise they are logged and skipped.
    """
    root = Path(directory)
    if not root.is_dir():
        if strict:
            raise FileNotFoundError(f"extensions directory not found: {root}")
        logger.warning("Extensions directory not found, skipping: %s", root)
        return []

    skills: list[Extension] = []
    for path in sorted(root.glob("*.md")):
        if not _SNAKE_CASE_RE.match(path.name):
            logger.debug("Skipping non-snake_case skill file: %s", path.name)
            continue
        try:
            skill = parse_extension_file(path)
        except ExtensionParseError as e:
            if strict:
                raise
            logger.warning("Failed to parse skill %s: %s", path.name, e)
            continue
        skills.append(skill)

    logger.info("Loaded %d skills from %s", len(skills), root)
    return skills


# ── Global singleton ──

extension_registry = ExtensionRegistry()


def _default_skills_dir() -> Path:
    """Return the default on-disk extensions directory: app/assistant/extensions/."""
    return Path(__file__).resolve().parent.parent / "skills"


_bootstrapped = False


def bootstrap_default_skills(*, force: bool = False) -> int:
    """Populate `extension_registry` from the default extensions directory.

    Idempotent: subsequent calls are no-ops unless `force=True`.
    Returns the number of skills loaded on this call.
    """
    global _bootstrapped
    if _bootstrapped and not force:
        return 0

    count = 0
    for skill in load_extensions_from_dir(_default_skills_dir(), strict=False):
        extension_registry.register(skill)
        count += 1

    _bootstrapped = True
    return count


def bootstrap_default_extensions(*, force: bool = False) -> int:
    return bootstrap_default_skills(force=force)
