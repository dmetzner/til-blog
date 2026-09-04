---
title: "A test that reads your docs"
description: "An ordinary failing test whose subject is a sentence. The mechanism is three lines: read the fact out of the code, look for it in the document, complain when it is missing."
pubDate: 2026-09-04
tags: ["testing", "tooling", "til"]
draft: false
---

Documentation rots because nothing breaks when it does. Change a port, ship it, and the
line in the README naming the old number is still sitting there — green build, green
tests, one lie.

A doc test is an ordinary test whose subject is a sentence instead of a function. The
whole mechanism is three pieces.

**The code owns a fact.**

```python
# server.py
PORT = 8787
```

**A document repeats it**, because somebody has to be told.

```markdown
<!-- CLAUDE.md -->
The dashboard binds 8787.
```

**The test reads the fact out of the code, then looks for it in the document.**

```python
port = read_port("server.py")               # 8787, parsed out of the source
if str(port) not in open("CLAUDE.md").read():
    sys.exit(f"CLAUDE.md does not say which port it binds ({port})")
```

That is the entire idea. Change `PORT` to 9090 and the next CI run fails with:

```text
CLAUDE.md does not say which port it binds (9090)
```

The document is now a thing that can be *wrong*, in the same way a function can be wrong,
and the build says so.

## The one step you cannot skip

`read_port` parses the number out of `server.py`. It matters that it is not written into
the test: `assert "8787" in doc` would pass forever after somebody changes the port,
because the number is now recorded in a third stale place instead of one. Read the fact
from the code and there is exactly one copy of the truth — and it is not the copy being
tested.

## Two more shapes, same trick

**A pointer must resolve.** If a document says "see `server.py:serve`", that is a claim
about the code: the file exists, and `serve` is *defined* in it. Check it by parsing the
source, not with `grep` — a search for a name is satisfied by the paragraph *discussing*
that name, which is exactly the state a rename leaves behind. My first version used a bare
`grep -q`, so a citation to `card` was happily satisfied by the word "card" in a comment.

**Some pointers are banned outright.** A line number does not survive an edit above it. A
commit hash does not survive a history rewrite — rewriting the history of my repos made
every hash in every document unresolvable at once. Neither can be maintained by hand, so
the check rejects them on sight.

## Which sentences are worth it

Not the prose. This is not a style gate, and one that demands a document be *good* gets
deleted within a week.

Test a sentence when somebody acting on the wrong version would do damage. A load-bearing
document has maybe ten of those among a hundred sentences of explanation. In my own setup
they turned out to be a network binding, which commands run with reduced permissions, and
two retention windows that exist for legal reasons — I found that out by deleting all four
during a cleanup and having the suite name them back to me.

## The script

```python
import ast, pathlib, re, sys

def _defs(path):
    """Every name DEFINED in a Python file — not the ones merely mentioned."""
    names = set()
    for n in ast.walk(ast.parse(pathlib.Path(path).read_text())):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(n.name)
        elif isinstance(n, ast.Assign):
            names |= {t.id for t in n.targets if isinstance(t, ast.Name)}
    return names

def read_port(path):
    for n in ast.walk(ast.parse(pathlib.Path(path).read_text())):
        if isinstance(n, ast.Assign) and any(getattr(t, "id", "") == "PORT" for t in n.targets):
            return n.value.value
    return None

def problems(doc):
    bad = []
    port = read_port("server.py")
    if port is None:                        # the premise is gone; say so, don't pass
        bad.append("server.py no longer defines PORT — this check has gone stale")
    elif str(port) not in doc:
        bad.append(f"does not say which port it binds ({port})")
    for rel, sym in re.findall(r"`([\w./-]+\.py):([A-Za-z_]\w*)`", doc):
        if not pathlib.Path(rel).exists():
            bad.append(f"cites {rel}:{sym} — no such file")
        elif sym not in _defs(rel):
            bad.append(f"cites {rel}:{sym} — not defined there")
    for line, sha in re.findall(r"`[\w./-]+\.\w+:(\d+)`|`([0-9a-f]{7,40})`", doc):
        bad.append(f"cites {line or sha} — cite a symbol instead")
    return bad

if __name__ == "__main__":
    if found := problems(pathlib.Path("CLAUDE.md").read_text()):
        sys.exit("CLAUDE.md " + "; ".join(found))
```

Run it from the repo root; it resolves pointers into Python only, and rule two is the
shape you extend for the other languages a document points at.

One detail worth copying: `problems()` takes the document *text*, so a test can break the
document in memory and assert the complaint. No wrong sentence ever has to be committed to
find out whether the gate would notice — and a gate nobody has watched fail is
indistinguishable from one that cannot.
