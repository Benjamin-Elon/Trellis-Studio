"""Draft task instructions and fill absent fields without replacing recipes or schedules."""  # CHANGE
from __future__ import annotations

import hashlib
import json
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .artifacts import unique_artifact_dir
from .jsonio import read_json, write_json
from .providers import OpenAIJsonClient

INSTRUCTION_FIELDS = {"instructions", "instructionProvenance"}  # CHANGE
INSTRUCTION_SCHEMA = {  # CHANGE: instruction-only output cannot change scheduling.
    "type": "object", "additionalProperties": False,
    "properties": {"rules": {"type": "array", "items": {
        "type": "object", "additionalProperties": False,
        "properties": {"id": {"type": "string"}, "instructions": {"type": "string"},
                       "sourceUrls": {"type": "array", "items": {"type": "string"}},
                       "sourceNote": {"type": "string"}},
        "required": ["id", "instructions", "sourceUrls", "sourceNote"],
    }}}, "required": ["rules"],
}


def validate_instruction_fields(rule: dict[str, Any]) -> list[str]:
    """Validate optional guidance on legacy and enriched template rules."""  # CHANGE
    errors = []
    if "instructions" in rule and not isinstance(rule["instructions"], str):
        errors.append("instructions must be text.")
    if "instructionProvenance" in rule:
        meta = rule["instructionProvenance"]
        if not isinstance(meta, dict):
            return errors + ["instructionProvenance must be an object."]
        if meta.get("status") not in {"draft", "customized", "reviewed"}:
            errors.append("instructionProvenance status is invalid.")
        urls = meta.get("sourceUrls", [])
        if not isinstance(urls, list) or any(not isinstance(url, str) or not url.startswith(("https://", "http://")) for url in urls):
            errors.append("instructionProvenance sourceUrls must contain web URLs.")
        if not isinstance(meta.get("sourceNote", ""), str):
            errors.append("instructionProvenance sourceNote must be text.")
    return errors


def schedule_signature(template: dict[str, Any]) -> str:
    """Identify an unchanged complete template while ignoring its instruction fields."""  # CHANGE
    value = {**template, "rules": [{key: val for key, val in rule.items() if key not in INSTRUCTION_FIELDS} for rule in template.get("rules", [])]}
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def draft_instructions(openai: OpenAIJsonClient, plant: dict[str, Any], method: dict[str, Any], template: dict[str, Any], sources: list[str] | None = None, notes: str = "") -> tuple[dict[str, Any], Any]:
    """Enrich absent instructions; IDs and every timing field come exclusively from the input."""  # CHANGE
    from .generator import _call_openai_with_retry  # CHANGE: reuse retries without a module-import cycle.
    missing = [rule for rule in template.get("rules", []) if "instructions" not in rule]
    ids = [str(rule.get("id") or "") for rule in missing]
    if not ids or any(not key for key in ids) or len(set(ids)) != len(ids):
        raise ValueError("Instruction drafting requires unique missing rule IDs.")
    allowed_urls = {source for source in (sources or []) if isinstance(source, str) and source.startswith(("https://", "http://"))}

    def validate(result: dict[str, Any]) -> list[str]:
        rules = result.get("rules")
        if not isinstance(rules, list) or len(rules) != len(ids):
            return ["Return exactly one instruction draft for each supplied rule ID."]
        errors, seen = [], set()
        for rule in rules:
            if not isinstance(rule, dict):
                errors.append("Instruction rules must be objects.")
                continue
            key = rule.get("id")
            if key not in ids or key in seen:
                errors.append("Instruction rule IDs must match the supplied rules exactly.")
            seen.add(key)
            if set(rule) != {"id", "instructions", "sourceUrls", "sourceNote"}:
                errors.append("Instruction drafts must not contain scheduling fields.")
            if not isinstance(rule.get("instructions"), str) or not rule["instructions"].strip():
                errors.append("Draft instructions must be nonempty text.")
            urls = rule.get("sourceUrls")
            if not isinstance(urls, list) or any(url not in allowed_urls for url in urls):
                errors.append("Source URLs must come from the supplied sources.")
            if not isinstance(rule.get("sourceNote"), str) or not rule["sourceNote"].strip():
                errors.append("Each draft needs a source or estimate note.")
        return errors

    result, trace = _call_openai_with_retry(
        openai, schema_name="trellis_task_instructions", json_schema=INSTRUCTION_SCHEMA, validator=validate,
        progress_label=f"Task instructions: {plant.get('plant_name')} / {method.get('method_id')}",
        system="Draft practical multiline task instructions for this crop and planting method. Keep every supplied rule ID. Use plant attributes and supplied sources. Do not invent URLs, change schedules, or claim a draft is reviewed. Explain conditional care where climate matters. If sources are insufficient, name the horticultural estimate in sourceNote.",
        user=json.dumps({"plant": plant, "method": method, "tasks": missing, "source_urls": sorted(allowed_urls), "notes": notes}, default=str),
    )
    enriched = json.loads(json.dumps(template))
    by_id = {rule["id"]: rule for rule in result["rules"]}
    for rule in enriched["rules"]:
        draft = by_id.get(rule.get("id"))
        if draft and "instructions" not in rule:
            rule["instructions"] = draft["instructions"]
            rule["instructionProvenance"] = {"status": "draft", "sourceUrls": draft["sourceUrls"], "sourceNote": draft["sourceNote"]}
    return enriched, trace


def load_instruction_targets(conn) -> list[dict[str, Any]]:
    """Read template identities from the database; missing tables are harmless on older catalogs."""  # CHANGE
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    targets = []
    for table in ("PlantTaskTemplates", "VarietyTaskTemplates"):
        if table not in tables:
            continue
        if table == "PlantTaskTemplates":
            query = "SELECT t.rowid AS template_rowid, t.*, p.plant_name FROM PlantTaskTemplates t JOIN Plants p ON p.plant_id=t.plant_id"
        else:
            query = "SELECT t.rowid AS template_rowid, t.*, p.plant_name, v.variety_name FROM VarietyTaskTemplates t JOIN PlantVarieties v ON v.variety_id=t.variety_id JOIN Plants p ON p.plant_id=v.plant_id"
        for record in conn.execute(query):
            row = dict(record)
            try:
                template = json.loads(row["template_json"])
                if not isinstance(template, dict) or not isinstance(template.get("rules"), list):
                    continue
                if any(not isinstance(rule, dict) for rule in template['rules']):  # CHANGE: malformed catalog rows are never patched.
                    continue
            except (ValueError, TypeError):
                continue
            targets.append({"template_table": table, "plant_name": row["plant_name"], "variety_name": row.get("variety_name"),
                            "method_id": row["method_id"], "recipe_id": row.get("recipe_id"), "template_rowid": row["template_rowid"], "template": template})
    return targets


def patch_match(target: dict[str, Any], patch: dict[str, Any]) -> bool:
    """Match portable identity and unchanged schedule, never row IDs from another database."""  # CHANGE
    keys = ("template_table", "plant_name", "variety_name", "method_id")
    return (all(target.get(key) == patch.get(key) for key in keys)
            and (not patch.get("recipe_id") or target.get("recipe_id") == patch["recipe_id"])
            and schedule_signature(target["template"]) == patch.get("schedule_signature"))


def preview_instruction_patch(targets: list[dict[str, Any]], patch: dict[str, Any]) -> dict[str, Any]:
    """Use the same guards for review and apply so authored or changed templates are skipped."""  # CHANGE
    matches = [target for target in targets if patch_match(target, patch)]
    identity = f"{patch.get('plant_name')} / {patch.get('method_id')} / {patch.get('rule_id')}"
    if len(matches) != 1:
        return {"action": "unchanged", "identity": identity, "changes": {}, "reason": "Template missing, ambiguous, or schedule changed."}
    rules = [rule for rule in matches[0]["template"]["rules"] if rule.get("id") == patch.get("rule_id")]
    if len(rules) != 1 or "instructions" in rules[0]:
        return {"action": "unchanged", "identity": identity, "changes": {}, "reason": "Instructions already present or rule ambiguous."}
    return {"action": "update", "identity": identity, "changes": {"instructions": {"old": None, "new": patch["instructions"]}}}


def apply_instruction_patches(conn, patches: list[dict[str, Any]]) -> int:
    """Apply only absent guidance inside the caller's transaction; never insert or delete recipes."""  # CHANGE
    targets = load_instruction_targets(conn)
    count = 0
    for patch in patches:
        if preview_instruction_patch(targets, patch)["action"] != "update":
            continue
        target = next(target for target in targets if patch_match(target, patch))
        rule = next(rule for rule in target["template"]["rules"] if rule.get("id") == patch["rule_id"])
        rule["instructions"] = patch["instructions"]
        rule["instructionProvenance"] = patch["instructionProvenance"]
        table = target["template_table"]  # CHANGE: table is selected from the fixed allowlist in the reader.
        conn.execute(f"UPDATE {table} SET template_json=?, updated_at=? WHERE rowid=?", [json.dumps(target["template"], separators=(",", ":")), datetime.now(timezone.utc).isoformat(), target["template_rowid"]])
        count += 1
    return count


def validate_instruction_patch(row: dict[str, Any]) -> list[str]:
    """Reject malformed instruction artifacts before database review or apply."""  # CHANGE
    errors = validate_instruction_fields(row)
    if row.get("template_table") not in {"PlantTaskTemplates", "VarietyTaskTemplates"}:
        errors.append("template_table must identify an existing task template table.")
    for key in ("plant_name", "method_id", "rule_id", "schedule_signature", "instructions"):
        if not isinstance(row.get(key), str) or not row[key].strip():
            errors.append(f"{key} is required.")
    if row.get("template_table") == "VarietyTaskTemplates" and not row.get("variety_name"):
        errors.append("variety_name is required for a variety template.")
    if "instructionProvenance" not in row:
        errors.append("instructionProvenance is required.")
    return errors


def generate_missing_instruction_run(settings, openai: OpenAIJsonClient) -> Path:
    """Create a normal reviewable run containing guarded patches, leaving the database untouched."""  # CHANGE
    from .db import connect, load_methods, load_plants
    from .validator import validate_run
    run_dir = unique_artifact_dir(settings.runs_dir, "run", datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S"), "task-instructions")
    (run_dir / "generated").mkdir(parents=True)
    plants = {plant["plant_name"]: plant for plant in load_plants(settings.db_path)}
    methods = {method["method_id"]: method for method in load_methods(settings.db_path)}
    with closing(connect(settings.db_path)) as conn:
        targets = load_instruction_targets(conn)
    patches, failures, traces, crop_drafts = [], [], [], {}
    targets.sort(key=lambda target: target["template_table"] != "PlantTaskTemplates")  # CHANGE: variety recipes inherit existing or newly drafted crop instructions.
    for target in targets:  # CHANGE: inheritance also uses existing authored crop instructions.
        if target['template_table'] == 'PlantTaskTemplates':
            key = (target['plant_name'], target['method_id'])
            if sum(item['template_table'] == 'PlantTaskTemplates' and (item['plant_name'], item['method_id']) == key for item in targets) == 1:
                crop_drafts[key] = target['template']['rules']
    for target in targets:
        template = json.loads(json.dumps(target["template"]))
        missing = [rule for rule in template["rules"] if "instructions" not in rule]
        if not missing:
            continue
        key = (target["plant_name"], target["method_id"])
        source_rules = crop_drafts.get(key, [])
        if target["template_table"] == "VarietyTaskTemplates":
            for rule in missing:
                inherited = [source for source in source_rules if source.get("id") == rule.get("id") and "instructions" in source]
                if len(inherited) == 1:
                    for field in INSTRUCTION_FIELDS:
                        if field in inherited[0]:
                            rule[field] = inherited[0][field]
        try:
            if any("instructions" not in rule for rule in template["rules"]):
                template, trace = draft_instructions(openai, plants[target["plant_name"]], methods[target["method_id"]], template)
                traces.append(trace.redacted())
            if target["template_table"] == "PlantTaskTemplates":
                crop_drafts[key] = template["rules"]
            for rule in missing:
                drafted = next(item for item in template["rules"] if item["id"] == rule["id"])
                patches.append({key: target.get(key) for key in ("template_table", "plant_name", "variety_name", "method_id", "recipe_id")} | {
                    "schedule_signature": schedule_signature(target["template"]), "rule_id": rule["id"],
                    "instructions": drafted["instructions"], "instructionProvenance": drafted.get("instructionProvenance", {"status": "draft", "sourceUrls": [], "sourceNote": "Inherited crop/method instructions."}),
                })
        except Exception as error:
            failures.append({"plant_name": target["plant_name"], "method_id": target["method_id"], "error": str(error)})
    write_json(run_dir / "generated" / "TaskInstructionPatches.json", patches)
    write_json(run_dir / "metadata.json", {"mode": "task_instructions_fill_missing", "status": "complete", "failures": failures})
    write_json(run_dir / "provenance.json", {"traces": traces})
    validate_run(run_dir, settings.db_path)
    return run_dir
