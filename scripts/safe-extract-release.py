#!/usr/bin/env python3
"""Strict, non-executable extraction of a Vivaion Empresas HML tar.gz.

Reject every link/device/special member *before* writing any files.
Use an empty directory created by the caller; do not preserve tar ownership,
modes, timestamps or destinations outside the staging directory.
"""
from __future__ import annotations

import os
import pathlib
import shutil
import sys
import tarfile

MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
MAX_EXPANDED_BYTES = 256 * 1024 * 1024
MAX_MEMBERS = 20000

EXACT_FILES = {
    "package.json", "package-lock.json",
    "backend/package.json", "frontend/package.json", "contracts/package.json",
    "data/catalog-v1.json", "data/course-details.json",
    "release-manifest.json", "SHA256SUMS",
}
FILE_PREFIXES = ("backend/dist/", "frontend/dist/", "contracts/dist/", "backend/migrations/")


def validate_name(name: str, directory: bool) -> str:
    if name in (".", "./") and directory:
        return ""
    if name.startswith("./"):
        name = name[2:]
    if name.endswith("/") and directory:
        name = name[:-1]
    parts = name.split("/")
    if (not name or name.startswith("/") or "\\" in name
            or any(p in ("", ".", "..") or p.startswith(".") for p in parts)
            or any(ord(ch) < 32 or ord(ch) == 127 for ch in name)):
        raise ValueError("Unsafe archive entry name")
    if directory:
        if not (any(prefix.startswith(name + "/") or name.startswith(prefix) for prefix in FILE_PREFIXES)
                or any(exact.startswith(name + "/") for exact in EXACT_FILES)):
            raise ValueError("Unexpected archive directory: " + name)
    elif name not in EXACT_FILES and not name.startswith(FILE_PREFIXES):
        raise ValueError("File is not on the HML package allowlist: " + name)
    return name


def extract_strict(archive: pathlib.Path, destination: pathlib.Path) -> dict:
    if not archive.is_file() or archive.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("Archive missing or too large")
    if not destination.is_dir() or destination.is_symlink() or any(destination.iterdir()):
        raise ValueError("Extraction destination must be a new empty directory")
    seen = set()
    total = 0
    with tarfile.open(archive, mode="r:gz", errorlevel=2) as tar:
        members = tar.getmembers()
        if len(members) > MAX_MEMBERS:
            raise ValueError("Too many archive entries")
        validated = []
        for member in members:
            # Never materialize links, devices, FIFOs or other unusual entries.
            if not (member.isfile() or member.isdir()):
                raise ValueError("Archive contains a non-regular file: " + member.name)
            rel = validate_name(member.name, member.isdir())
            if not rel:
                continue
            if rel in seen:
                raise ValueError("Duplicate archive entry: " + rel)
            seen.add(rel)
            if member.size < 0:
                raise ValueError("Negative archive member size")
            if member.isfile():
                total += member.size
                if total > MAX_EXPANDED_BYTES:
                    raise ValueError("Expanded archive too large")
            validated.append((member, rel))

        # No output occurred until *all* entries passed the safety checks.
        for member, rel in validated:
            target = destination.joinpath(*rel.split("/"))
            if member.isdir():
                target.mkdir(mode=0o700, parents=True, exist_ok=True)
                continue
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            source = tar.extractfile(member)
            if source is None:
                raise ValueError("Unreadable archive member: " + rel)
            flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
            flags |= getattr(os, "O_NOFOLLOW", 0)
            fd = os.open(target, flags, 0o600)
            with source, os.fdopen(fd, "wb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)
                if output.tell() != member.size:
                    raise ValueError("Unexpected archive member length: " + rel)
    return {"files": sum(m.isfile() for m, _ in validated), "total_bytes": total}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: safe-extract-release.py ARCHIVE.tgz EMPTY_DIRECTORY")
    try:
        result = extract_strict(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]))
        print("Strict extraction passed: " + str(result))
    except (ValueError, OSError, tarfile.TarError) as exc:
        print("REJECTED: " + str(exc), file=sys.stderr)
        raise SystemExit(1)
