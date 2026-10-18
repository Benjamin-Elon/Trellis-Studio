"""Device-local maintainer credentials; Windows never falls back to environment keys."""  # NEW
from __future__ import annotations

import ctypes
from ctypes import wintypes
import os

from .jsonio import register_secret

TARGETS = {"openai": "Trellis/Seeder/OpenAI", "fdc": "Trellis/Seeder/FoodDataCentral"}  # NEW
ENVIRONMENT_NAMES = {"openai": "OPENAI_API_KEY", "fdc": "FDC_API_KEY"}  # NEW


class CredentialError(RuntimeError):
    """Credential storage failed; messages intentionally contain no secret values."""  # NEW


class _Credential(ctypes.Structure):
    """Native CREDENTIALW layout, including pointer-sized fields on 64-bit Windows."""  # NEW
    _fields_ = [
        ("Flags", wintypes.DWORD), ("Type", wintypes.DWORD),
        ("TargetName", wintypes.LPWSTR), ("Comment", wintypes.LPWSTR),
        ("LastWritten", wintypes.FILETIME), ("CredentialBlobSize", wintypes.DWORD),
        ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)), ("Persist", wintypes.DWORD),
        ("AttributeCount", wintypes.DWORD), ("Attributes", ctypes.c_void_p),
        ("TargetAlias", wintypes.LPWSTR), ("UserName", wintypes.LPWSTR),
    ]


class WindowsCredentialStore:
    """Minimal Win32 binding. Only missing entries are treated as absent credentials."""  # NEW
    def __init__(self) -> None:
        if os.name != "nt":
            raise CredentialError("Windows Credential Manager is unavailable on this platform.")
        self.dll = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
        self.dll.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.POINTER(_Credential))]
        self.dll.CredReadW.restype = wintypes.BOOL
        self.dll.CredWriteW.argtypes = [ctypes.POINTER(_Credential), wintypes.DWORD]
        self.dll.CredWriteW.restype = wintypes.BOOL
        self.dll.CredDeleteW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
        self.dll.CredDeleteW.restype = wintypes.BOOL
        self.dll.CredFree.argtypes = [ctypes.c_void_p]
        self.dll.CredFree.restype = None

    def read(self, target: str) -> str:
        """Copy a UTF-8 generic credential and always free the native allocation."""  # NEW
        pointer = ctypes.POINTER(_Credential)()
        if not self.dll.CredReadW(target, 1, 0, ctypes.byref(pointer)):
            code = ctypes.get_last_error()
            if code == 1168:  # NEW: ERROR_NOT_FOUND is distinct from access/session errors.
                return ""
            raise CredentialError(f"Cannot read Windows credential (error {code}).")
        try:
            entry = pointer.contents
            if not 0 < entry.CredentialBlobSize <= 2560 or not entry.CredentialBlob:
                raise CredentialError("Stored credential is malformed; replace it in Settings and credentials.")
            value = ctypes.string_at(entry.CredentialBlob, entry.CredentialBlobSize).decode("utf-8").strip()
            if not value or "\x00" in value:
                raise CredentialError("Stored credential is malformed; replace it in Settings and credentials.")
            return value
        except UnicodeError:
            raise CredentialError("Stored credential cannot be decoded; replace it in Settings and credentials.") from None
        finally:
            self.dll.CredFree(pointer)

    def write(self, target: str, value: str) -> None:
        """Persist for this Windows user on this machine, never as a roaming credential."""  # NEW
        encoded = value.encode("utf-8")
        if not encoded or len(encoded) > 2560 or "\x00" in value:
            raise CredentialError("Credential must contain between 1 and 2560 UTF-8 bytes without null characters.")
        buffer = (ctypes.c_ubyte * len(encoded)).from_buffer_copy(encoded)
        entry = _Credential(Type=1, TargetName=target, CredentialBlobSize=len(encoded), CredentialBlob=buffer, Persist=2)
        try:
            if not self.dll.CredWriteW(ctypes.byref(entry), 0):
                raise CredentialError(f"Cannot save Windows credential (error {ctypes.get_last_error()}).")
        finally:
            ctypes.memset(buffer, 0, len(encoded))

    def delete(self, target: str) -> None:
        """Delete one entry; deleting an already absent entry is harmless."""  # NEW
        if not self.dll.CredDeleteW(target, 1, 0):
            code = ctypes.get_last_error()
            if code != 1168:
                raise CredentialError(f"Cannot remove Windows credential (error {code}).")


def read_api_key(provider: str) -> str:
    """Load on demand and register active values for diagnostic redaction."""  # NEW
    target = TARGETS[provider]
    value = WindowsCredentialStore().read(target) if os.name == "nt" else os.environ.get(ENVIRONMENT_NAMES[provider], "").strip()
    register_secret(value)
    return value


def save_api_key(provider: str, value: str) -> None:
    """Verify replacement and restore the previous entry if saving fails."""  # NEW
    target = TARGETS[provider]
    value = value.strip()
    if not value:
        raise CredentialError("Enter a nonblank API key; use Remove to delete an existing key.")
    register_secret(value)
    store = WindowsCredentialStore()
    previous = store.read(target)
    try:
        store.write(target, value)
        if store.read(target) != value:
            raise CredentialError("Saved credential verification failed.")
    except Exception:
        try:
            if previous:
                store.write(target, previous)
            else:
                store.delete(target)
        except Exception:
            raise CredentialError("Credential save and rollback failed; check Windows Credential Manager.") from None
        raise CredentialError("Credential was not saved; the previous entry was preserved.") from None


def delete_api_key(provider: str) -> None:
    """Remove only the named maintainer credential."""  # NEW
    WindowsCredentialStore().delete(TARGETS[provider])
