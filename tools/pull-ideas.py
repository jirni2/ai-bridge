#!/usr/bin/env python3
"""Забирає ідеї Сергія, надіслані кнопкою «Запропонувати ідею» з «Що нового»
(POST /api/idea -> KV ключ idea:v1), і дописує їх у скриньку розвідника
~/workspace/goals/ai-bridge/hidden_files/idea-inbox.md з міткою джерела «Сергій».

Вивантаження: GET /api/idea на production через збережений конектор
custom.ai-bridge (authd surrogates, browser User-Agent — edge блокує небразерних).
Жоден сирий токен не друкується, не логується і не зберігається.

Запуск (на старті циклу builder): python3 tools/pull-ideas.py [--dry-run]
Водяний знак: ~/workspace/goals/ai-bridge/hidden_files/idea-kv-watermark.json
"""
import argparse
import datetime
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

BASE = "https://aibridge-aff.pages.dev"
HOSTS = ["aibridge-aff.pages.dev"]
CRED = "custom.ai-bridge"
UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) "
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 "
      "Mobile/15E148 Safari/604.1")
HOME = os.path.expanduser("~")
INBOX = os.path.join(HOME, "workspace/goals/ai-bridge/hidden_files/idea-inbox.md")
WATERMARK = os.path.join(HOME, "workspace/goals/ai-bridge/hidden_files/idea-kv-watermark.json")
TZ = "America/Regina"


def fetch_ideas():
    req = urllib.request.Request(BASE + "/api/idea", method="GET",
                                 headers={"User-Agent": UA, "Accept": "application/json"})
    add_surrogate_to_request(req, CRED, allowed_hosts=HOSTS)
    try:
        resp = urllib.request.urlopen(req, timeout=60)
        payload = read_json_response(resp)
        return resp.status, payload
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode("utf-8", "replace"))
        except Exception:
            payload = {"unreadable_body": True}
        return e.code, payload


def idea_id(item):
    h = hashlib.sha256(
        f"{item.get('ts', '')}|{item.get('title', '')}".encode("utf-8")).hexdigest()
    return h[:16]


def fmt_ts_regina(ts_ms):
    try:
        import zoneinfo
        tz = zoneinfo.ZoneInfo(TZ)
        dt = datetime.datetime.fromtimestamp(float(ts_ms) / 1000, tz=tz)
    except Exception:
        dt = datetime.datetime.fromtimestamp(float(ts_ms) / 1000)
    return dt.strftime("%Y-%m-%d %H:%M")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    status, payload = fetch_ideas()
    if status != 200 or not payload.get("ok"):
        print(f"GET /api/idea: HTTP {status} — {json.dumps(payload, ensure_ascii=False)[:300]}",
              file=sys.stderr)
        return 1
    items = payload.get("items", [])
    if not isinstance(items, list):
        print("GET /api/idea: items — не масив.", file=sys.stderr)
        return 1
    print(f"ідей у KV (через API): {len(items)}")

    try:
        with open(WATERMARK, "r", encoding="utf-8") as f:
            merged = set(json.load(f).get("merged", []))
    except Exception:
        merged = set()

    fresh = [it for it in items
             if isinstance(it, dict) and it.get("title") and idea_id(it) not in merged]
    print(f"нових: {len(fresh)}")
    if not fresh:
        return 0

    blocks = []
    for it in fresh:
        name = str(it.get("title", ""))[:80]
        desc = str(it.get("desc", ""))[:500]
        ts = fmt_ts_regina(it.get("ts", 0))
        block = (f"\n## [new] {ts} — {name}\n"
                 f"- Джерело: застосунок AI Bridge («Що нового» → «Запропонувати ідею», Сергій)\n"
                 f"- Чому підходить: пряма пропозиція Сергія з застосунку.\n"
                 f"- Обсяг: M\n"
                 + (f"- Нотатки: {desc}\n" if desc else ""))
        blocks.append(block)
        if not args.dry_run:
            merged.add(idea_id(it))

    if args.dry_run:
        print("".join(blocks))
        print("(dry-run: нічого не записано)")
        return 0

    with open(INBOX, "a", encoding="utf-8") as f:
        f.write("\n".join(blocks) + "\n")
    with open(WATERMARK, "w", encoding="utf-8") as f:
        json.dump({"merged": sorted(merged)}, f, ensure_ascii=False, indent=1)
    print(f"дописано {len(fresh)} ідею(й) у idea-inbox.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
