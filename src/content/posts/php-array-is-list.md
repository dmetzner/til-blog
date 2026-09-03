---
title: "PHP's array_is_list() is underrated"
description: "JSON has arrays and objects; PHP has one type for both. So \"is this a list or a map?\" is a question you keep asking — and since 8.1 you stop writing the answer yourself."
pubDate: 2026-06-19
tags: ["php", "til"]
---

Before PHP 8.1 I kept writing the same tiny helper: is this array a *real* list —
keys `0, 1, 2` in order — or a map with names for keys? It comes up constantly,
because JSON distinguishes a list from an object and PHP stores both in the same
type.

The language ships it now:

```php
array_is_list([1, 2, 3]);        // true
array_is_list([1 => 'a']);       // false
array_is_list(['a' => 1]);       // false
array_is_list([]);               // true — empty counts as a list
```

The catch is that it only looks at keys, never at contents — and an empty array
is a list. That's usually what you want when you're deciding whether to encode
something as a JSON array or object, and it bites if "empty" is supposed to mean
"nothing decided yet". Same idea as
[not caching a silence](/posts/reading-open-library-without-hammering-a-nonprofit/):
"no shape" and "the empty shape" are different answers.

One less utility to maintain.
