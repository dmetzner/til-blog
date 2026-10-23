---
title: "An Android game engine in the browser, without rewriting its source"
description: "Compile the app's existing engine to JavaScript, then patch whatever the browser lacks until the build is green."
pubDate: 2026-10-23
tags: ["web", "tooling", "til"]
draft: false
---

Kids build games with Pocket Code, an Android app, and share them on
[share.catrobat.org](https://share.catrobat.org/), the site I work on. On a phone
with the app you tap a project and play it. In a desktop browser you get a
screenshot. I wanted a Play button in the browser.

The obvious plan is a JavaScript player that understands Pocket Code projects. A
project is made of bricks (the blocks kids snap together, like "move 10 steps"), plus
sensors and functions used inside them. I measured how far a partial player would get:
across 253 projects on share, 150 of those features make two thirds of them fully
playable, and all 253 need 220. Then I would own a second engine forever, and every
new brick would need a second implementation, missing on the web until someone wrote it.

So I did not write a player. I compiled the app's engine.

## Compile the engine, don't port it

The engine behind Pocket Code (its source is
[Catroid](https://github.com/Catrobat/Catroid)) draws with libGDX, a Java game
library. [TeaVM](https://teavm.org/) is an ahead-of-time compiler that turns compiled
Java into JavaScript, and [gdx-teavm](https://github.com/xpenatan/gdx-teavm) is a
libGDX backend for it. TeaVM reads compiled classes, not source. So the web build takes
the app's compiled engine and its 211 library jars, with no source changes, and
compiles those.

The first attempt reported 232 things missing: an Android app expects Android, and a
browser has none of it. Before the build runs, a small tool rewrites every jar, using
[ASM](https://asm.ow2.io/) to edit the compiled code directly. It knows three moves:

- **Remap** a class to a web version I wrote: Android's `Log` prints to the
  console, its `SystemClock` reads the browser's clock.
- **Redirect** a single call to a small replacement, such as `ConcurrentHashMap.keys()`,
  when only that call is missing, not the whole class.
- **Stub** a method that uses something with no web version in this build, such as
  the MIDI driver (a native library), Raspberry Pi hardware, or Google login. Its
  body becomes one line that throws "Not available on the web".

The build then runs, reads TeaVM's list of what is still missing, stubs those methods
too, and goes again, until the list comes back empty:

```text
round 1: 55 newly missing
round 2: 3 newly missing
Player built (round 3): 74 Catroid methods unavailable on the web
```

Seventy-four of the app's own methods stubbed across about 2,200 of its classes; everything else is the app's
own code, compiled, not reimplemented. So far it has run one test project, a pen that
draws a circle; loading real project files is the next step. Which app version it
compiles is one commit hash in one file.

The catch: when the app gains a brick that needs something the
browser lacks, the loop stubs it and the build stays green, but that brick now throws
when a project uses it. A green build says the engine compiles, not that every project
plays. I don't know yet which of the 253 projects touch one of the 74.

## What actually got in the way

Most real problems were assumptions about Android that nobody ever had to write down,
plus two gaps in the toolchain.

**Android's compile-time library only throws.** To compile against Android you get a
jar where every method throws `"Stub!"`. Android's unit tests use a "mockable" variant
whose methods return zero or null instead, so I generate one of those. That works for
most code, with one exception:

**A point that remembers nothing.** The pen recorded its positions as
`android.graphics.PointF`. In the mockable jar its constructor does nothing, so every
point was (0, 0), every line had length zero, and the sprite moved in a perfect circle
while drawing nothing. Value classes need real web versions, not defaults, so
`PointF` got one.

**A pen buffer that started black.** The stage came out solid black. The pen draws into
an off-screen buffer that the app clears with whatever clear colour is current when the
buffer is created. On Android a fresh graphics context starts transparent; in the
browser, the backend had left it opaque black. One line sets it back before the stage
starts.

**Physics has no browser build.** Every stage creates a Box2D physics world, even with
no physics bricks, and libGDX's Box2D is native C++. libGDX ships a pure-Java emulation
of the same API for its old GWT web backend, as
[`gdx-box2d-gwt` sources](https://central.sonatype.com/artifact/com.badlogicgames.gdx/gdx-box2d-gwt).
Compiled into a jar, it slots in where the native one was.

**A crash that names nothing.** TeaVM's code generator died with a bare
`NullPointerException`, naming nothing. The cause was `Foo.class` constants for
classes that exist in no jar at all. TeaVM never reports those as missing; it just
falls over. Now a scan finds them, and they get stubbed like everything else.

## The rewrite step, in code

The heart of it, trimmed, is one loop over each method's compiled instructions. A call on the
redirect list becomes a static call into my compatibility class, with the old receiver
as the first argument. Anything that touches a missing symbol marks the method for
stubbing. Remapping whole classes happens before this, with ASM's `ClassRemapper` and a
table of names.

```java
for (AbstractInsnNode insn = method.instructions.getFirst(); insn != null; insn = insn.getNext()) {
	if (insn instanceof MethodInsnNode call) {
		String target = REDIRECT.get(call.owner + "." + call.name + call.desc);
		if (target != null) {
			if (call.getOpcode() != Opcodes.INVOKESTATIC) {
				// the receiver becomes the first argument: map.keys() -> WebCompat.keys(map)
				call.desc = "(L" + receiver(call.owner, target) + ";" + call.desc.substring(1);
			}
			call.setOpcode(Opcodes.INVOKESTATIC);
			call.owner = "org/catrobat/web/compat/WebCompat";
			call.name = target;
			continue;
		}
	}
	if (reason == null) {
		reason = missingUse(insn, missing); // a missing method, field, class or Foo.class constant
	}
}
if (reason != null) {
	// replace the whole body: throw new UnsupportedOperationException("Not available on the web: ...")
}
```

## When I would not do this

If an app's logic is tangled into its Android screens, this stubs the app away. It got
this far because the engine is a libGDX game that happened to live in an Android
app, with Android at the edges. The output is also big: about 20 MB of unminified
JavaScript today, which is fine behind a Play button and not fine on a landing page.
