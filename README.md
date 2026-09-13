# psense

Patched Acer Predator/Nitro hardware tooling for NixOS, vendored as source.

This repo holds already-patched source trees for two upstream projects, so a
NixOS flake can build them directly without carrying its own patch files or
`fetchpatch` URLs.

| Directory | Upstream | Upstream rev | Integrated modifications |
|---|---|---|---|
| `linuwu-sense/` | [0x7375646F/Linuwu-Sense](https://github.com/0x7375646F/Linuwu-Sense) | `73a25ec243a44ba2b1703e8d0a76fa2735062506` | PR #103, back-logo, `strncpy`→`memcpy`, `<linux/string.h>` |
| `rusense/` | [r3nv-dev/rusense](https://github.com/r3nv-dev/rusense) | `f92bd8db0a8e04030d66c68dec654e9d6041d70a` | back-logo |

## Integrated modifications

### PR #103 (PHN16S-71 support)
Upstream [PR #103](https://github.com/0x7375646F/Linuwu-Sense/pull/103) adds hardware quirks for `PHN16-73`, `PHN16S-71`, and the `PHIN16S-71` BIOS typo variant. Only the `PHN16S-71` part is kept; see *Model pruning* below.

### Rear back-logo driver
Adds a `back_logo` sysfs attribute group to the kernel driver, exposing `/sys/devices/platform/acer-wmi/back_logo/color` via ACPI method `12` (`0x0C`) on `WMID_GUID4`, plus an `ACER_CAP_BACK_LOGO` capability flag and per-model quirk entries.

### Kernel 7.2+ string safety
Applied to `linuwu-sense/src/linuwu_sense.c`. Upstream is removing `strncpy` from kernel headers (PR #130, targeting 7.2.0+), and this tree is built with `linuxPackages_latest`. `memcpy` avoids the sysfs truncation that the `strscpy` variant caused. Explicit `<linux/string.h>` is included for 7.2+ header resolution.

### RuSense back-logo support
Adds back-logo control across `core/` (domain, port trait, sysfs backend), `tui/` (`'l'` keybind), and `gui/` (Tauri frontend). Persists the preferred state to `/var/lib/rusense/back_logo` or `~/.local/state/rusense/back_logo` and re-applies it across the ~1–2s window where the Acer EC resets the LED on AC transitions.

## Model pruning

DMI quirk entries that can never match this machine (an Acer Predator PHN16S-71) are stripped from the vendored kernel driver:

| Removed | Why |
|---|---|
| `quirk_acer_predator_phn16_73` struct + its DMI entry | Wrong model. Added by PR #103 commit 1. |
| `PHIN16S-71` DMI entry | BIOS-typo variant. This BIOS reports `Predator PHN16S-71`, correctly spelled, so the typo entry never matches. |
| Duplicate `PHN16S-71` entry → `quirk_acer_predator_v4` | Unreachable. PR #103 commit 3 appends a second `"Predator PHN16S-71"` entry pointing at the generic quirk *after* the real one. Linux quirk tables are first-match-wins, so it can never fire. |

Net effect: 32 lines removed, 3 added.

## Consuming from a flake

### NixOS Module (recommended)

```nix
# flake.nix
inputs.psense = {
  url = "github:srinivasr/psense";
  inputs.nixpkgs.follows = "nixpkgs";
};
```

```nix
# configuration.nix
imports = [
  inputs.psense.nixosModules.default
];

hardware.psense.enable = true;
```

Enabling `hardware.psense.enable` automatically:
- Builds `linuwu_sense` for the active kernel (`config.boot.kernelPackages`) and loads it
- Blacklists conflicting `acer_wmi`
- Sets up the `linuwu_sense` group, udev rules, and `/sys` tmpfiles permissions
- Manages the `rusense-backlogo-sync` service on AC adapter plug/unplug events
- Registers clean module unloading on shutdown
- Installs `rusense` (GUI and TUI) into system packages

### Standalone Packages

```nix
environment.systemPackages = [
  inputs.psense.packages.${pkgs.system}.default # RuSense GUI + TUI
];
```

## Verified

Both trees build against nixpkgs `0954f7ee2f6bb3dc7d4e3d0d8bcb8fd4bde4cfc5` (nixos-unstable, 2026-07-29) with `linuxPackages_latest`:

- `linuwu-sense` → `linuwu_sense.ko`, vermagic `7.1.5`, `back_logo_show` / `back_logo_store` symbols and the `PHN16S-71` model string present (`PHN16-73` and `PHIN16S-71` pruned).
- `rusense` → `rusense` + `rusense-gui` binaries, `rusense.desktop`, icon installed; `toggle_back_logo` / `set_back_logo` present in both binaries (99 unit tests passing across core and TUI).

## License

Both upstream projects are GPL-3.0 / GPL-3.0-only and remain under their original licenses and copyright.