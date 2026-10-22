---
title: "Every clock gets caught by a better one"
description: "From pendulums to quartz to atoms: each new clock exposed the errors of the last one, until it caught the Earth itself running unevenly."
pubDate: 2026-10-22
tags: ["hardware", "til"]
draft: false
---

While reading up on [hrtime vs microtime](/posts/php-hrtime-for-durations/) I asked a
question that sounds like a trick: if every clock is checked against a better clock, who
checks the first one?

The answer is a ladder. Every rung was the best clock in the world until a better one
showed up and caught it lying.

## Rung 1: the sky

For most of history the reference was the Earth itself. One turn is a day, and a second
is a fraction of it. Mechanical clocks were set by the sun and the stars, and they needed
it: before the pendulum they drifted by about fifteen minutes a day.

## Rung 2: the pendulum

In 1656 Christiaan Huygens built the first pendulum clock. A swinging weight has a fixed
rhythm, so clocks went from a quarter of an hour off per day to well under a minute.
For almost three centuries nothing beat it. It still answered to the stars, though:
observatories checked their pendulum clocks against the night sky.

## Rung 3: quartz

In 1927 Warren Marrison at Bell Labs built one of the first clocks driven by a vibrating
quartz crystal. Quartz bends slightly when you put a voltage on it and makes a voltage
when it bends, so a small circuit can keep it ringing at a very steady rate.

Within a few years quartz clocks were steady enough to catch the referee. Compared with
them, the Earth's rotation was not even: it speeds up and slows down a little over the
year. The best clock had found a flaw in the thing that defined time.

Your watch still uses this rung. Its crystal is a tiny tuning fork that vibrates 32,768
times a second. That number is 2¹⁵, so fifteen halving circuits turn it into exactly one
tick per second. It is also the lowest power of two above human hearing, so the watch
doesn't whine. A crystal that ticks once a second would save those circuits, but it would
have to be huge.

## Rung 4: the atom

Astronomers first switched to *ephemeris time*, based on the Earth's orbit around the sun,
which is steadier than its spin. That only lasted until a better clock showed up.

In 1955 Louis Essen and Jack Parry built the first practical caesium clock in England.
It doesn't count a swinging weight or a bending crystal but radiation from caesium atoms,
and every caesium atom is the same. In 1967 the world gave up on the sky: one second is
now [defined](https://en.wikipedia.org/wiki/Second) as 9,192,631,770 periods of that
radiation.

That is how the chicken-and-egg problem ends. Hundreds of atomic clocks around the world
are averaged into one time scale, and that average drifts too. A handful of primary
caesium clocks keep it on track. There is no better clock to compare those with, so they
are checked another way: each lab works out how much every known effect, such as heat,
magnetic fields and gravity, shifts its atoms, and the labs compare their clocks with each
other. The first clock is calibrated by physics, not by another clock.

## Rung 5: already in the lab

The ladder isn't finished. Optical clocks use atoms that oscillate far faster than
caesium and are already more precise. By 2015 one was accurate enough to notice being lifted by
[two centimetres](https://en.wikipedia.org/wiki/Optical_clock), because time runs slightly
faster further from the Earth's gravity. The plan is to redefine the second around them in
the 2030s.

## Back to PHP

That ladder is also why PHP has two clocks. `microtime()` reads the wall clock, which the
time sync service keeps pulling towards atomic time, sometimes with a jump. `hrtime()`
only counts forward on the machine's own oscillator, so nobody can reset it mid-measurement.
