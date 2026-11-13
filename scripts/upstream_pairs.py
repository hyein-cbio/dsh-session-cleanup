"""Pinned compatibility cells, not arbitrary version/gate overrides."""

import os

PAIRS = {
    "validated": {
        "harness_repository": "deepseek-ai/deepseek-harness",
        "harness_ref": "b830ec950faba0a46dda564be3e2d854afed94f1",
        "harness_version": "0.2.1-rc.5",
        "tui_repository": "ccch1mneyyy/dsh-TUI",
        "tui_ref": "1d0d946f459da5149aba64cc6cc0ef7da304053c",
        "tui_version": "0.18.0",
    },
    # Historical candidate retained for reproducing the pre-merge evidence.
    "candidate-022": {
        "harness_repository": "deepseek-ai/deepseek-harness",
        "harness_ref": "66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db",
        "harness_version": "0.2.2-rc.1",
        "tui_repository": "Lucas2011wastaken/dsh-TUI",
        "tui_ref": "fb0b5325be7704fbdd09a7d7d8d642fca4d42f77",
        "tui_version": "0.18.0",
    },
    # Final squash merge of PR #1886; distinct from the v0.19.0 release commit.
    "merged-022": {
        "harness_repository": "deepseek-ai/deepseek-harness",
        "harness_ref": "66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db",
        "harness_version": "0.2.2-rc.1",
        "tui_repository": "ccch1mneyyy/dsh-TUI",
        "tui_ref": "e7336a62030064daa2e4593f0ec7311c9c362b71",
        "tui_version": "0.18.0",
    },
    # Published GitHub Latest at the time of that record, v0.19.0.
    # Not the unreleased merge above, and not the later v0.20.0 release.
    "released-019": {
        "harness_repository": "deepseek-ai/deepseek-harness",
        "harness_ref": "66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db",
        "harness_version": "0.2.2-rc.1",
        "tui_repository": "ccch1mneyyy/dsh-TUI",
        "tui_ref": "224f847d02c2157f43862d2792cf9d7459222f4c",
        "tui_version": "0.19.0",
    },
    # Published GitHub Latest v0.20.0 and the Harness line that commit names.
    "released-020": {
        "harness_repository": "deepseek-ai/deepseek-harness",
        "harness_ref": "ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c",
        "harness_version": "0.2.2-rc.2",
        "tui_repository": "ccch1mneyyy/dsh-TUI",
        "tui_ref": "8958f08e3ba09a3db37d35c490d9589c114e7136",
        "tui_version": "0.20.0",
    },
}


def selected_pair():
    name = os.environ.get("DSH_COMPAT_PAIR", "validated")
    if name not in PAIRS:
        raise SystemExit(f"unknown DSH_COMPAT_PAIR: {name!r}; choose one of {', '.join(PAIRS)}")
    return PAIRS[name].copy()


if __name__ == "__main__":
    for key, value in selected_pair().items():
        print(f"{key}={value}")
