# psense

High-performance, hardware-optimized Acer Predator / Nitro tooling for Linux & NixOS, vendored as source.

This repository integrates low-overhead optimizations and reverse-engineered hardware profiles from OEM PredatorSense (Acer Predator PHN16S-71 / Helios Neo 16S AI with RTX 40-series dGPU) into vendored trees for direct NixOS flake builds.

| Directory | Upstream | Upstream rev | Integrated modifications |
|---|---|---|---|
| `linuwu-sense/` | [0x7375646F/Linuwu-Sense](https://github.com/0x7375646F/Linuwu-Sense) | `73a25ec243a44ba2b1703e8d0a76fa2735062506` | PR #103, EC jiffies cache, in-driver AC reassert, back-logo, `strncpy`→`memcpy`, `<linux/string.h>` |
| `rusense/` | [r3nv-dev/rusense](https://github.com/r3nv-dev/rusense) | `f92bd8db0a8e04030d66c68dec654e9d6041d70a` | Zero-polling sysfs caching, adaptive visibility GUI polling, back-logo |

## Integrated modifications & Hardware Optimizations

### 1. Embedded Controller (EC) LPC Bus Jiffies Cache
Reading 3 temperatures and 2 fan speeds through hwmon triggers 5 serialized ACPI WMI evaluations over the slow LPC/eSPI EC bus. When multiple tools query sensors concurrently (e.g. RuSense + MangoHud + BTOP + desktop widgets), this can cause micro-stutters.
- Added a 300ms jiffies telemetry cache in `acer_wmi_hwmon_read()`. Burst or multi-sensor queries return instantly from memory, slashing EC bus traffic by ~80% and preventing bus contention.

### 2. In-Kernel AC Event Delayed Re-assertion
The Acer Embedded Controller firmware reboots and resets the rear lightbar / logo LED to ON across a 200–1200ms window on AC plug/unplug events.
- Added `schedule_delayed_work(&back_logo_reassert_work, msecs_to_jiffies(500))` in `linuwu_sense.c` directly on `WMID_AC_EVENT`.
- Eliminates the previous brute-force userspace bash script that spawned 6 delayed sleep processes.

### 3. Zero-Polling Sysfs Path & File Caching
In `rusense/core/src/sysfs.rs`, `SysfsSense::telemetry()` previously ran `read_dir` on `/sys/.../hwmon` and `/sys/class/power_supply` on every tick, reading `/name`, allocating vectors, and reading files from disk.
- Added thread-safe in-memory caching for `hwmon_cache`, `battery_cache`, `profile_dir_cache`, and `desired_back_logo`.
- Drops ~18 filesystem traversals and disk reads per 2-second tick down to zero, allowing CPU cores to remain in deep C-states.

### 4. Visibility-Aware Adaptive GUI Polling
- Added Page Visibility API tracking in `rusense/gui/frontend/app.js`.
- Automatically halts background Tauri telemetry polling when the window is minimized or hidden behind games/apps, eliminating unnecessary IPC wakeups and CPU/GPU power consumption.

### 5. Battery Power Optimization & Quiet/ECO Mode Unblocking
- **Fixed Kernel Battery Profile Gate**: In `linuwu_sense.c`, unblocked `PLATFORM_PROFILE_QUIET` and `PLATFORM_PROFILE_LOW_POWER` (ECO) when running on battery power (`!on_AC`), ensuring the system can drop into quiet fan speeds and low wattage when unplugged.
- **Auto Power Profile Sync**: Added NixOS module options (`hardware.psense.autoPowerProfile`, `batteryProfile = "quiet"`, `acProfile = "balanced-performance"`) and `rusense-power-sync.service` to automatically drop into energy-saving modes when unplugged and restore gaming profiles upon plugging in AC power.

### 6. Reverse-Engineered OEM PredatorSense Parity (PHN16S-71)
Reverse-engineering of the Windows OEM DriverStore (`predatorservice.inf`) and `ULICTekInc.PredatorSenseforNotebook` revealed:
- **WMI Methods**: Root ACPI class `AcerGamingFunction` on `WMID_GUID4` exposes methods 1–25:
  - Method 1: System info & thermal readings
  - Method 2: Fan mode & manual speed control
  - Method 12 (0x0C) & 13 (0x0D): Rear logo RGB & brightness control
  - Method 14 (0x0E): Platform thermal profiles (Quiet, Balanced, Performance, Turbo)
  - Method 20 (0x14) & 21 (0x15): 4-Zone RGB keyboard backlight and mode control
  - Method 22 (0x16): GPU Overclocking offsets & LCD overdrive
- **Turbo GPU Boost Clocks**:
  - `Turbo` thermal profile applies a hardware GPU overclock of **+100 MHz Core Clock Offset** and **+200 MHz VRAM Clock Offset**. Implemented in `rusense` via automatic `nvidia-settings` boost application.
- **4-Zone RGB Keyboard Control**:
  - Full keyboard lighting control with 8 hardware modes (Static, Breathing, Neon, Wave, Shifting, Zoom, Meteor, Twinkle), custom color presets, and brightness sliders integrated into `rusense` core, GUI, and TUI (`[r]` hotkey).
- **LCD Overdrive (3ms)**:
  - Hardware display panel overdrive toggle exposed in `linuwu-sense` sysfs (`predator_sense/lcd_override`), core domain, and GUI/TUI (`[o]` hotkey).
- **Predator Boot Sound**:
  - Startup animation and chime audio toggle exposed via `predator_sense/boot_animation_sound` in sysfs, core domain, and GUI/TUI (`[s]` hotkey).
- **Authentic Predator Cyber-Cockpit UI**:
  - Extracted the proprietary OEM typography (`Predator-Regular.otf`), cockpit stealth palette (`#142B39` / `#071924`), and glowing Predator Cyan (`#00c8ec`) into `rusense-gui`. Users can toggle seamlessly between Predator and Nitro themes.

### 7. PR #103 & Model Pruning (PHN16S-71)
Upstream [PR #103](https://github.com/0x7375646F/Linuwu-Sense/pull/103) adds hardware quirks for `PHN16-73`, `PHN16S-71`, and the `PHIN16S-71` BIOS typo variant. Only the `PHN16S-71` part is kept:
- `quirk_acer_predator_phn16_73` struct removed (wrong model).
- `PHIN16S-71` removed (this laptop's DMI correctly reports `Predator PHN16S-71`).
- Duplicate unreachable generic `PHN16S-71` entry removed.

### 8. Kernel 7.2+ String Safety
`strncpy` replaced with `memcpy` in `linuwu_sense.c` to prevent sysfs truncation and ensure clean builds against `linuxPackages_latest`. Explicit `<linux/string.h>` included.

## Consuming from a Flake

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
- Manages the `rusense-power-sync` and `rusense-init` services (auto power profile switching, 240Hz/60Hz refresh rate, EPP tuning, RTD3, 80% charge threshold, and rear logo sync)
- Registers clean module unloading on shutdown
- Installs `rusense` (GUI and TUI) into system packages

### Standalone Packages

```nix
environment.systemPackages = [
  inputs.psense.packages.${pkgs.system}.default # RuSense GUI + TUI
];
```

## Verified

Both trees build against nixpkgs `0954f7ee2f6bb3dc7d4e3d0d8bcb8fd4bde4cfc5` (nixos-unstable) with `linuxPackages_latest`:
- `linuwu-sense` → `linuwu_sense.ko`, vermagic `7.1.5+`, `back_logo_show` / `back_logo_store` symbols and the `PHN16S-71` model string present.
- `rusense` → `rusense` + `rusense-gui` binaries, `rusense.desktop`, icon installed; unit tests passing across core and TUI.

## License

Both upstream projects are GPL-3.0 / GPL-3.0-only and remain under their original licenses and copyright.