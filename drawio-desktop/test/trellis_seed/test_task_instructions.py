"""Instruction enrichment and guarded database patch integration tests."""  # CHANGE
from __future__ import annotations

import copy
from contextlib import closing
import json
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from trellis_seed.db import connect, apply_run, create_diff_report  # noqa: E402
from trellis_seed.generator import build_task_template_from_method, _generate_crops  # noqa: E402
from trellis_seed.providers import ProviderTrace, ProviderError  # noqa: E402
from trellis_seed.jsonio import read_json, write_json  # noqa: E402
from trellis_seed.task_instructions import (draft_instructions, schedule_signature, validate_instruction_patch,
    load_instruction_targets, apply_instruction_patches, generate_missing_instruction_run)  # noqa: E402
from trellis_seed.validator import validate_run, validate_task_template  # noqa: E402
from trellis_seed.config import Settings  # noqa: E402


class FakeInstructions:
    model = 'fake'
    reasoning_effort = 'low'

    def __init__(self, mutate=None):
        self.requests = []
        self.mutate = mutate

    def generate_json(self, **kwargs):
        self.requests.append(kwargs)
        context = json.JSONDecoder().raw_decode(kwargs['user'])[0]  # CHANGE: retries append repair guidance after the original JSON.
        result = {'rules': [{'id': rule['id'], 'instructions': f"1. {rule['id']} {context['plant']['plant_name']}\n2. Check conditions.",
                             'sourceUrls': context['source_urls'], 'sourceNote': 'Draft based on supplied plant attributes; horticultural estimate.'} for rule in context['tasks']]}
        if self.mutate:
            self.mutate(result)
        return result, ProviderTrace('openai', {'schema': kwargs['schema_name']})


class InstructionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.db = self.root / 'seed.sqlite'
        shutil.copy2(ROOT / 'trellis_database/Trellis_database.sqlite', self.db)
        self.method = {'method_id': 'direct_sow.field', 'method_category_id': 'direct_sow', 'tasks_required_json': json.dumps({'sow': True, 'thin': True})}
        self.template = build_task_template_from_method(self.method)

    def tearDown(self):
        self.tmp.cleanup()

    def setup_templates(self):
        with closing(connect(self.db)) as conn:
            plant = conn.execute('SELECT plant_id,plant_name FROM Plants ORDER BY plant_id LIMIT 1').fetchone()
            method = conn.execute('SELECT method_id FROM PlantingMethods ORDER BY method_id LIMIT 1').fetchone()[0]
            conn.execute('DELETE FROM PlantTaskTemplates')
            conn.execute('DELETE FROM VarietyTaskTemplates')
            conn.execute('INSERT INTO PlantTaskTemplates (plant_id,method_id,template_json,recipe_id,recipe_name,owner_user_id,updated_at) VALUES (?,?,?,?,?,?,?)',
                         [plant['plant_id'], method, json.dumps(self.template), 'system-test', 'Unchanged name', 'original-owner', '2026-10-11'])
            variety = conn.execute('SELECT variety_id FROM PlantVarieties WHERE plant_id=? LIMIT 1', [plant['plant_id']]).fetchone()
            if variety:
                conn.execute('INSERT INTO VarietyTaskTemplates (variety_id,method_id,template_json,updated_at) VALUES (?,?,?,?)', [variety[0], method, json.dumps(self.template), '2026-10-11'])
            conn.commit()  # CHANGE: closing a connection releases Windows file handles but does not commit it.
        return plant['plant_name'], method

    def test_drafts_preserve_every_schedule_field_and_use_crop_method_sources(self):
        before = copy.deepcopy(self.template)
        fake = FakeInstructions()
        enriched, _ = draft_instructions(fake, {'plant_name': 'Carrot', 'planting_depth': '1 cm'}, self.method, self.template, ['https://example.test/carrot'], 'Regional guidance')
        self.assertEqual(self.template, before)
        self.assertEqual(schedule_signature(enriched), schedule_signature(before))
        self.assertEqual(validate_task_template(enriched), [])
        self.assertEqual(json.loads(fake.requests[0]['user'])['method']['method_id'], 'direct_sow.field')
        self.assertTrue(all(rule['instructionProvenance']['status'] == 'draft' for rule in enriched['rules']))
        self.assertTrue(all(rule['instructionProvenance']['sourceUrls'] == ['https://example.test/carrot'] for rule in enriched['rules']))

    def test_provider_cannot_change_rule_ids_schedules_or_invent_urls(self):
        for mutate in (lambda result: result['rules'][0].update(id='invented'),
                       lambda result: result['rules'][0].update(startOffsetDays=500),
                       lambda result: result['rules'][0].update(sourceUrls=['https://invented.test/'])):
            with self.subTest(mutate=mutate):
                fake = FakeInstructions(mutate)
                with self.assertRaises(ProviderError):
                    draft_instructions(fake, {'plant_name': 'Carrot'}, self.method, self.template)
                self.assertEqual(len(fake.requests), 2)
        self.assertTrue(all('instructions' not in rule for rule in self.template['rules']))

    def test_explicit_empty_and_authored_instructions_are_not_drafted(self):
        self.template['rules'][0]['instructions'] = ''
        self.template['rules'][1]['instructions'] = 'User text'
        fake = FakeInstructions()
        enriched, _ = draft_instructions(fake, {'plant_name': 'Carrot'}, self.method, self.template)
        self.assertEqual(enriched['rules'][0]['instructions'], '')
        self.assertEqual(enriched['rules'][1]['instructions'], 'User text')
        self.assertEqual(len(json.loads(fake.requests[0]['user'])['tasks']), 1)

    def test_new_crop_generation_drafts_instructions_and_varieties_inherit_without_schedule_changes(self):
        from test_seeder import complete_plant_row  # CHANGE: reuse the complete validated crop fixture.
        class CropAndInstructions(FakeInstructions):
            def generate_json(inner, **kwargs):
                if kwargs['schema_name'] == 'trellis_crop_row':
                    return {'row': complete_plant_row(plant_name='Carrot'), 'allowed_method_categories': ['direct_sow'],
                            'allowed_method_ids': ['direct_sow.field'], 'provenance': {'field_sources': []}}, ProviderTrace('fake', {})
                return super().generate_json(**kwargs)
        settings = Settings(self.root / 'config.json', {'db_path': str(self.db), 'runs_dir': str(self.root / 'runs')})
        input_data = {'crops': [{'name': 'Carrot', 'sources': ['https://example.test/carrot'], 'variety_task_overrides': [{'variety_name': 'Mid maturity', 'method_id': 'direct_sow.field'}]}]}
        generated = {table: [] for table in ('Plants', 'PlantAllowedMethodCategories', 'PlantVarieties', 'PlantTaskTemplates', 'VarietyTaskTemplates')}
        provenance = {'traces': [], 'tables': {}}
        fake = CropAndInstructions()
        with patch('trellis_seed.generator.synthesize_nutrition_for_plant', return_value=([], [], [])):
            _generate_crops(settings, input_data, fake, [self.method], generated, provenance, self.root, generate_templates=True)
        template = json.loads(generated['PlantTaskTemplates'][0]['template_json'])
        variety = json.loads(generated['VarietyTaskTemplates'][0]['template_json'])
        self.assertEqual(len(fake.requests), 1)
        self.assertEqual(template['rules'], variety['rules'])
        self.assertEqual([{key: value for key, value in rule.items() if key not in {'instructions', 'instructionProvenance'}} for rule in template['rules']], self.template['rules'])
        self.assertTrue(all(rule['instructions'] for rule in template['rules']))

    def test_existing_crop_instructions_are_inherited_by_missing_variety_rules(self):
        self.setup_templates()
        with closing(connect(self.db)) as conn:
            template = copy.deepcopy(self.template)
            for rule in template['rules']:
                rule['instructions'] = 'User-authored ' + rule['id']
            conn.execute('UPDATE PlantTaskTemplates SET template_json=?', [json.dumps(template)])
            conn.commit()
        fake = FakeInstructions()
        run = generate_missing_instruction_run(SimpleNamespace(db_path=self.db, runs_dir=self.root / 'runs'), fake)
        self.assertEqual(fake.requests, [])
        patches = read_json(run / 'generated/TaskInstructionPatches.json')
        self.assertTrue(all(row['template_table'] == 'VarietyTaskTemplates' and row['instructions'].startswith('User-authored') for row in patches))

    def test_patch_validation_rejects_wrong_table_metadata_and_missing_identity(self):
        errors = validate_instruction_patch({'template_table': 'Plants', 'instructions': 42, 'instructionProvenance': {'status': 'trusted', 'sourceUrls': ['javascript:alert(1)']}})
        self.assertTrue(any('template_table' in error for error in errors))
        self.assertTrue(any('instructions' in error for error in errors))
        self.assertTrue(any('sourceUrls' in error for error in errors))

    def test_fill_missing_run_is_reviewable_inherits_varieties_and_is_idempotent(self):
        self.setup_templates()
        settings = SimpleNamespace(db_path=self.db, runs_dir=self.root / 'runs')
        fake = FakeInstructions()
        run = generate_missing_instruction_run(settings, fake)
        self.assertEqual(len(fake.requests), 1)
        self.assertTrue(validate_run(run, self.db)['ok'])
        patches = read_json(run / 'generated/TaskInstructionPatches.json')
        self.assertGreaterEqual(len(patches), len(self.template['rules']))
        with closing(connect(self.db)) as conn:
            self.assertTrue(all('instructions' not in rule for target in load_instruction_targets(conn) for rule in target['template']['rules']))
        diff = create_diff_report(run, self.db)
        self.assertTrue(all(item['action'] == 'update' for item in diff['tables']['TaskInstructionPatches']))
        report = apply_run(run, self.db)
        self.assertEqual(report['tables']['TaskInstructionPatches'], len(patches))
        with closing(connect(self.db)) as conn:
            metadata = conn.execute('SELECT recipe_name,owner_user_id FROM PlantTaskTemplates').fetchone()
            self.assertEqual(tuple(metadata), ('Unchanged name', 'original-owner'))
            for target in load_instruction_targets(conn):
                self.assertEqual(schedule_signature(target['template']), schedule_signature(self.template))
                self.assertTrue(all(rule['instructionProvenance']['status'] == 'draft' for rule in target['template']['rules']))
        self.assertEqual(apply_run(run, self.db)['tables']['TaskInstructionPatches'], 0)

    def test_apply_rechecks_authored_content_changed_schedules_and_ambiguous_targets(self):
        self.setup_templates()
        run = generate_missing_instruction_run(SimpleNamespace(db_path=self.db, runs_dir=self.root / 'runs'), FakeInstructions())
        patches = read_json(run / 'generated/TaskInstructionPatches.json')
        with closing(connect(self.db)) as conn:
            value = json.loads(conn.execute('SELECT template_json FROM PlantTaskTemplates').fetchone()[0])
            value['rules'][0]['instructions'] = 'Written after generation'
            conn.execute('UPDATE PlantTaskTemplates SET template_json=?', [json.dumps(value)])
            plant_patches = [row for row in patches if row['template_table'] == 'PlantTaskTemplates']
            self.assertEqual(apply_instruction_patches(conn, plant_patches), len(value['rules']) - 1)
            result = json.loads(conn.execute('SELECT template_json FROM PlantTaskTemplates').fetchone()[0])
            self.assertEqual(result['rules'][0]['instructions'], 'Written after generation')
            value['rules'][0].pop('instructions'); value['rules'][0]['startOffsetDays'] += 1
            conn.execute('UPDATE PlantTaskTemplates SET template_json=?', [json.dumps(value)])
            self.assertEqual(apply_instruction_patches(conn, plant_patches), 0)

    def test_provider_failure_leaves_templates_intact_and_reports_failure(self):
        self.setup_templates()
        fake = FakeInstructions(lambda result: result['rules'][0].update(id='wrong'))
        run = generate_missing_instruction_run(SimpleNamespace(db_path=self.db, runs_dir=self.root / 'runs'), fake)
        self.assertEqual(read_json(run / 'generated/TaskInstructionPatches.json'), [])
        self.assertTrue(read_json(run / 'metadata.json')['failures'])
        with closing(connect(self.db)) as conn:
            self.assertTrue(all('instructions' not in rule for target in load_instruction_targets(conn) for rule in target['template']['rules']))


if __name__ == '__main__':
    unittest.main()
