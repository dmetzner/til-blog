---
title: "Stop watching the terminal — let it text you"
description: "A Telegram bot can report when a long job finishes; the useful decision is what is safe to put in the message."
pubDate: 2026-08-27
tags: ["tooling", "apis", "til"]
draft: false
---

I don't want to sit and watch an agent work. It runs for twenty minutes, I check
on it eleven times, and ten of those were pointless. Meanwhile the phone that
would happily tell me the answer is in my pocket all day, doing nothing.

So I looked into it, half expecting to lose an evening. **It's a chat with a bot,
and then one line.** You message Telegram's setup bot, it hands you a key, and
from then on your machine can write to you like a person would. Nothing to
install, nothing to host.

Setup is the easy part. What belongs in the message is the real decision.
A bot chat is a normal Telegram chat, so it isn't end-to-end encrypted — those
messages are exactly as private as Telegram itself. Mine only ever sends a nudge:
*build green*, *job done*, *disk almost full*. No names, no numbers, no content.
It's a doorbell, not a letter.

When I want the detail, it goes somewhere that asks who I am first. The ping says
*look now*, and [the actual report waits behind a
login](/posts/read-what-it-decided/) — a far better read than a phone
notification anyway.

Two things to know before you build one. The bot can't message you until you've
messaged it once — that's how it learns where *you* are. And it carries about one
message per second, per chat: plenty for notifications, useless as a log.

## The whole thing, in code

```bash
# 1. chat with @BotFather in Telegram → /newbot → it hands you a token
# 2. send your new bot any message from your phone (it can't talk first)
# 3. ask who "you" are:
curl -s "https://api.telegram.org/bot$TOKEN/getUpdates" \
  | jq '.result[0].message.chat.id'

# 4. that's the entire notification:
curl -s "https://api.telegram.org/bot$TOKEN/sendMessage" \
  -d chat_id="$CHAT_ID" -d text="build green"
```

One caveat if the machine isn't only yours: the token and the message text sit in
`curl`'s arguments, where anyone who can run `ps` will see them. `curl -K -` reads
the URL from stdin instead and keeps both out of the process list.

No app, no server, nothing to host.

## Follow-up resources

- [Bots: an introduction for developers](https://core.telegram.org/bots) — including the "a bot can't start the conversation" rule
- [Bot FAQ — broadcasting limits](https://core.telegram.org/bots/faq) — the per-chat, per-group and bulk numbers
