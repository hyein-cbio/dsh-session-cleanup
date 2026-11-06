"""Pinned CI cells and bounded evidence shared by both cloud execution paths."""

from pathlib import PurePosixPath

NODES = {
    "22.23.4": "1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce",
    "24.22.1": "6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6",
}
LIVE_CELLS = {"validated": "22.23.4", "merged-022": "24.22.1"}
CI_CELLS = (
    {"id": "package-node22", "suite": "package", "node_version": "22.23.4", "pair": ""},
    {"id": "package-node24", "suite": "package", "node_version": "24.22.1", "pair": ""},
    {"id": "live-validated", "suite": "live", "node_version": "22.23.4", "pair": "validated"},
    {"id": "live-merged-022", "suite": "live", "node_version": "24.22.1", "pair": "merged-022"},
)
PNPM_VERSION = "11.28.5"
MAX_FILES = 128
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024


def validate_cell(suite, node_version, pair=""):
    if node_version not in NODES:
        raise ValueError(f"unsupported CI Node version: {node_version}")
    if suite == "package" and not pair:
        return
    if suite == "live" and LIVE_CELLS.get(pair) == node_version:
        return
    raise ValueError(f"unsupported CI cell: {suite}/{node_version}/{pair}")


def evidence_path(name):
    """Only relative text reports, never an archive, source tree or profile."""
    if not isinstance(name, str) or not name or "\\" in name:
        raise ValueError("invalid evidence path")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in {".", ".."} or part.startswith(".") for part in path.parts):
        raise ValueError("unsafe evidence path")
    if path.as_posix() != name or not name.endswith((".json", ".jsonl", ".log", ".txt", ".xml")):
        raise ValueError("evidence must be a normalized relative text report")
    return path
