"""Credential isolation, native binding failures, and artifact redaction regressions."""  # NEW
from __future__ import annotations

import ctypes
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import traceback
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace
from urllib.error import HTTPError, URLError
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from trellis_seed import credentials, config, jsonio
from trellis_seed.providers import FoodDataCentralClient, OpenAIJsonClient, ProviderError, ProviderTrace


class CredentialTests(unittest.TestCase):
    def setUp(self):
        self.registry = set(jsonio._active_secrets)
        self.warning = config._fdc_demo_warned
        self.addCleanup(self.restore)

    def restore(self):
        jsonio._active_secrets.clear()
        jsonio._active_secrets.update(self.registry)
        config._fdc_demo_warned = self.warning

    def test_windows_ignores_environment_and_config_credentials(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "ignored-env", "FDC_API_KEY": "ignored-fdc"}), patch.object(credentials, "WindowsCredentialStore") as factory:
            factory.return_value.read.return_value = "encrypted-synthetic"
            with patch.object(credentials.os, "name", "nt"):
                self.assertEqual(config.read_openai_api_key(), "encrypted-synthetic")
                self.assertEqual(config.read_fdc_api_key(), "encrypted-synthetic")
            self.assertEqual(factory.return_value.read.call_args_list[0].args, (credentials.TARGETS["openai"],))
        client = FoodDataCentralClient(config.DEFAULT_CONFIG["fdc"] | {"api_key": "ignored-json"})
        with patch("trellis_seed.providers.read_fdc_api_key", return_value="runtime-value"), patch.object(client, "_get_json", return_value={}) as fetch:
            client.search("carrot")
            self.assertIn("api_key=runtime-value", fetch.call_args.args[0])
            self.assertNotIn("ignored-json", fetch.call_args.args[0])

    def test_nonwindows_reads_trimmed_environment_at_call_time(self):
        with patch.object(credentials.os, "name", "posix"), patch.dict(os.environ, {"FDC_API_KEY": " first "}):
            self.assertEqual(config.read_fdc_api_key(), "first")
            os.environ["FDC_API_KEY"] = " second "
            self.assertEqual(config.read_fdc_api_key(), "second")

    def test_missing_and_blank_fdc_warn_once_without_hiding_storage_errors(self):
        config._fdc_demo_warned = False
        output = io.StringIO()
        with patch.object(config, "read_api_key", return_value=""), patch("sys.stdout", output):
            self.assertEqual(config.read_fdc_api_key(), "DEMO_KEY")
            self.assertEqual(config.read_fdc_api_key(), "DEMO_KEY")
        self.assertEqual(output.getvalue().count("shared rate limit"), 1)
        with patch.object(config, "read_api_key", side_effect=credentials.CredentialError("Storage unavailable")):
            with self.assertRaises(credentials.CredentialError):
                config.read_fdc_api_key()
        with patch.object(credentials.os, "name", "posix"), patch.dict(os.environ, {"FDC_API_KEY": "  "}):
            self.assertEqual(credentials.read_api_key("fdc"), "")

    def test_settings_strip_legacy_secrets_without_mutating_other_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / "config.json"
            original = {"openai_api_key": "legacy-one", "openai_model": "keep-model", "fdc": {"apiKey": "legacy-two", "page_size": 4}, "custom": {"authorization": "old-auth", "keep": [1, 2]}}
            filename.write_text(json.dumps(original), encoding="utf-8")
            settings = config.load_settings(filename)
            self.assertNotIn("openai_api_key", settings.data)
            self.assertNotIn("apiKey", settings.data["fdc"])
            config.save_settings(config.Settings(filename, original))
            saved = json.loads(filename.read_text(encoding="utf-8"))
            self.assertEqual(saved, {"openai_model": "keep-model", "fdc": {"page_size": 4}, "custom": {"keep": [1, 2]}})
            self.assertEqual(original["fdc"]["apiKey"], "legacy-two")
            self.assertNotIn("api_key", config.DEFAULT_CONFIG["fdc"])

    def test_replacement_verification_failure_restores_previous_entry(self):
        store = Mock()
        store.read.side_effect = ["previous-synthetic", "wrong-result"]
        with patch.object(credentials, "WindowsCredentialStore", return_value=store):
            with self.assertRaisesRegex(credentials.CredentialError, "previous entry was preserved"):
                credentials.save_api_key("openai", "replacement-synthetic")
        self.assertEqual(store.write.call_args_list[-1].args[1], "previous-synthetic")

    def test_failed_new_write_is_removed_and_blank_input_never_writes(self):
        store = Mock()
        store.read.return_value = ""
        store.write.side_effect = credentials.CredentialError("failed")
        with patch.object(credentials, "WindowsCredentialStore", return_value=store):
            with self.assertRaises(credentials.CredentialError):
                credentials.save_api_key("fdc", "new-synthetic")
            store.delete.assert_called_once_with(credentials.TARGETS["fdc"])
            with self.assertRaises(credentials.CredentialError):
                credentials.save_api_key("fdc", "  ")

    def test_replacement_write_failure_and_rollback_failure_are_safe(self):
        store = Mock()
        store.read.return_value = "previous-synthetic"
        store.write.side_effect = [credentials.CredentialError("failed"), None]
        with patch.object(credentials, "WindowsCredentialStore", return_value=store):
            with self.assertRaisesRegex(credentials.CredentialError, "preserved"):
                credentials.save_api_key("fdc", "new-synthetic")
            store.write.side_effect = credentials.CredentialError("failed")
            with self.assertRaisesRegex(credentials.CredentialError, "rollback failed"):
                credentials.save_api_key("fdc", "new-synthetic")

    @unittest.skipUnless(os.name == "nt", "Win32 error-state binding")
    def test_native_missing_access_error_and_delete(self):
        store = object.__new__(credentials.WindowsCredentialStore)
        store.dll = Mock()
        store.dll.CredReadW.return_value = False
        store.dll.CredDeleteW.return_value = False
        with patch.object(ctypes, "get_last_error", return_value=1168):
            self.assertEqual(store.read("Synthetic/Test"), "")
            store.delete("Synthetic/Test")
        with patch.object(ctypes, "get_last_error", return_value=5):
            with self.assertRaisesRegex(credentials.CredentialError, "error 5"):
                store.read("Synthetic/Test")
            with self.assertRaises(credentials.CredentialError):
                store.delete("Synthetic/Test")

    @unittest.skipUnless(os.name == "nt", "Win32 native allocation layout")
    def test_native_malformed_entries_free_the_allocation(self):
        store = object.__new__(credentials.WindowsCredentialStore)
        store.dll = Mock()
        for value in (b"\xff", b"   ", b""):
            buffer = (ctypes.c_ubyte * len(value)).from_buffer_copy(value)
            entry = credentials._Credential(CredentialBlobSize=len(value), CredentialBlob=buffer)
            def supply(_target, _kind, _flags, result):
                ctypes.cast(result, ctypes.POINTER(ctypes.POINTER(credentials._Credential)))[0] = ctypes.pointer(entry)
                return True
            store.dll.CredReadW.side_effect = supply
            with self.assertRaises(credentials.CredentialError):
                store.read("Synthetic/Test")
        self.assertEqual(store.dll.CredFree.call_count, 3)

    @unittest.skipUnless(os.name == "nt", "Windows Credential Manager integration")
    def test_native_round_trip_uses_unique_entry_and_always_cleans_up(self):
        store = credentials.WindowsCredentialStore()
        target = "Trellis/Tests/" + str(uuid4())
        self.addCleanup(store.delete, target)
        store.write(target, "synthetic-native-round-trip")
        self.assertEqual(credentials.WindowsCredentialStore().read(target), "synthetic-native-round-trip")
        store.delete(target)
        self.assertEqual(store.read(target), "")

    def test_nested_url_header_and_active_value_redaction_reaches_files(self):
        secret = "synthetic-sensitive-value/+"
        jsonio.register_secret(secret)
        original = {"headers": {"Authorization": "Bearer hidden-token"}, "url": "https://example.test/?api_key=unknown-key&query=carrot", "nested": [secret, "Bearer another-token", "api%5Fkey=encoded-key&other=keep"]}
        trace = ProviderTrace("fdc", original, error="Failure " + secret).redacted()
        encoded = json.dumps(trace)
        for forbidden in (secret, "hidden-token", "unknown-key", "another-token", "encoded-key"):
            self.assertNotIn(forbidden, encoded)
        self.assertIn("query=carrot", encoded)
        self.assertIn("other=keep", encoded)
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / "metadata.json"
            jsonio.write_json(filename, {"error": secret})
            self.assertNotIn(secret, filename.read_text(encoding="utf-8"))

    def test_fdc_failure_suppresses_raw_traceback_and_keeps_429_retry(self):
        secret = "synthetic-fdc-failure"
        jsonio.register_secret(secret)
        client = FoodDataCentralClient(config.DEFAULT_CONFIG["fdc"] | {"rate_limit_max_attempts": 2})
        error = HTTPError("https://test/?api_key=" + secret, 429, secret, {"Retry-After": "0"}, None)
        self.addCleanup(error.close)  # NEW: close the synthetic HTTP response deterministically.
        with patch("trellis_seed.providers.urllib.request.urlopen", side_effect=[error, URLError(secret)]), patch("trellis_seed.providers.time.sleep") as sleep, patch("sys.stdout", io.StringIO()):
            try:
                client._get_json("https://test/?api_key=" + secret)
            except ProviderError:
                self.assertNotIn(secret, traceback.format_exc())
            else:
                self.fail("Provider error expected")
        sleep.assert_called_once_with(0)

    def test_openai_initialization_and_request_errors_hide_active_key(self):
        secret = "synthetic-openai-failure"
        client = OpenAIJsonClient(secret, "synthetic-model")
        for factory in (Mock(side_effect=RuntimeError(secret)), Mock(return_value=SimpleNamespace(responses=SimpleNamespace(create=Mock(side_effect=RuntimeError(secret)))))):
            with patch.dict(sys.modules, {"openai": SimpleNamespace(OpenAI=factory)}):
                try:
                    client.generate_json(system="", user="", schema_name="test", json_schema={})
                except ProviderError:
                    self.assertNotIn(secret, traceback.format_exc())
                else:
                    self.fail("Provider error expected")
