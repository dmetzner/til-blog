---
title: "PHP's array_is_list() is underrated"
description: "A tiny 8.1 function that replaces a surprising amount of hand-rolled key checking."
pubDate: 2026-06-19
tags: ["php", "til"]
---

Before PHP 8.1 I kept writing little helpers to check whether an array was a
"real" list (keys `0..n-1`, in order) or an associative map. Turns out the
language ships it now:

```php
array_is_list([1, 2, 3]);        // true
array_is_list([1 => 'a']);       // false
array_is_list(['a' => 1]);       // false
```

Handy when you're normalising JSON input or deciding whether to encode something
as a JSON array vs object. One less utility to maintain.
