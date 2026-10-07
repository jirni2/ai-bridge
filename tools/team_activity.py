#!/usr/bin/env python3
"""Дайджест активності команди агентів для 30-хвилинних звітів.
Читає /api/team/*, порівнює з watermark, друкує що нового, оновлює watermark.
"""
import json, os, sys, urllib.request, urllib.error

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

BASE = "https://aibridge-aff.pages.dev"
HOSTS = ["aibridge-aff.pages.dev"]
CRED = "custom.ai-bridge"
UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) "
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1")
WM = "/home/hatch/workspace/goals/ai-bridge/hidden_files/agent_reports/last.json"
STATUS = "/home/hatch/workspace/goals/ai-bridge/hidden_files/design_redesign/STATUS.md"


def call(path, method="GET", body=None, timeout=60):
    data = None
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("User-Agent", UA)
    req.add_header("Accept", "application/json")
    add_surrogate_to_request(req, CRED, allowed_hosts=HOSTS)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    try:
        resp = urllib.request.urlopen(req, data=data, timeout=timeout)
        return resp.status, read_json_response(resp)
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode("utf-8", "replace"))
        except Exception:
            payload = {"unreadable_body": True}
        return e.code, payload
    except Exception as e:
        return 0, {"transport_error": str(e)[:200]}


def main():
    os.makedirs(os.path.dirname(WM), exist_ok=True)
    try:
        wm = json.load(open(WM))
    except Exception:
        wm = {"tasks": {}, "events_seen": 0, "report_date": None}
    out = []
    # --- tasks ---
    s, p = call("/api/team/tasks")
    tasks = p.get("tasks", []) if isinstance(p, dict) and s == 200 else []
    if s != 200:
        out.append(f"API tasks недоступний: HTTP {s}")
    new_tasks, changed = [], []
    cur = {}
    for t in tasks:
        tid = t.get("id")
        cur[tid] = t.get("status")
        old = wm.get("tasks", {}).get(tid)
        if old is None:
            new_tasks.append(t)
        elif old != t.get("status"):
            changed.append((t, old))
    for t in new_tasks:
        out.append(f"НОВЕ завдання: [{t.get('role')}] {t.get('title','')[:80]} — {t.get('status')}")
    for t, old in changed:
        res = t.get("result")
        summ = ""
        if isinstance(res, dict) and res.get("summary"):
            summ = " — " + str(res["summary"])[:120]
        elif isinstance(res, str) and res:
            summ = " — " + res[:120]
        out.append(f"ЗМІНА: [{t.get('role')}] {t.get('title','')[:60]}: {old} → {t.get('status')}{summ}")
    # --- events ---
    s, p = call("/api/team/events?limit=20")
    events = p.get("events", []) if isinstance(p, dict) and s == 200 else []
    seen = wm.get("events_seen", 0)
    fresh = [e for e in events if (e.get("ts") or 0) > seen]
    for e in sorted(fresh, key=lambda x: x.get("ts") or 0)[-8:]:
        out.append(f"ПОДІЯ [{e.get('kind')}/{e.get('actor')}]: {str(e.get('msg') or e.get('text') or '')[:120]}")
    max_ts = max([e.get("ts") or 0 for e in events] + [seen])
    # --- daily report ---
    s, p = call("/api/team/report")
    rep = p.get("report") if isinstance(p, dict) else None
    rep_date = rep.get("date") if isinstance(rep, dict) else None
    if rep_date and rep_date != wm.get("report_date"):
        out.append(f"Щоденний звіт команди за {rep_date} готовий.")
    # --- design status ---
    design = None
    try:
        with open(STATUS) as f:
            design = f.read().strip().splitlines()
    except Exception:
        pass
    if design:
        # перші змістовні рядки статусу
        head = [l for l in design if l.strip() and not l.startswith("#")][:4]
        out.append("Редизайн: " + " | ".join(x.strip("- ").strip()[:100] for x in head if x.strip()))
    else:
        out.append("Редизайн: статус-файл ще не створено.")
    # --- watermark ---
    wm = {"tasks": cur, "events_seen": max_ts, "report_date": rep_date}
    json.dump(wm, open(WM, "w"))
    print("\n".join(out) if out else "Нової активності немає.")
    # сирі цифри для звіту
    act = sum(1 for v in cur.values() if v in ("queued", "running"))
    print(f"__stats__ tasks={len(cur)} active={act} new={len(new_tasks)} changed={len(changed)}")


if __name__ == "__main__":
    main()
