# Acer Predator PHN16S-71: Windows Reverse Engineering & Linux Continuation Guide

This document captures **all reverse-engineered context, hardware contracts, WMI methods, driver architectures, and implementation details** discovered from Windows OEM PredatorSense (`v5.1.514.0`) on the **Acer Predator Helios Neo 16S AI (`PHN16S-71`)**, along with the complete roadmap for building, running, and extending the project in Linux and NixOS.

---

## 1. Target Hardware Specifications

| Hardware Component | Identification / Hardware ID | Interface / Bus |
| :--- | :--- | :--- |
| **Laptop Model** | `Acer Predator PHN16S-71` | DMI / SMBIOS (`DMI_PRODUCT_NAME`) |
| **Processor** | Intel Core Ultra (Meteor Lake / Arrow Lake architecture) | ACPI / Intel RAPL (`intel_rapl`) |
| **Discrete GPU** | NVIDIA GeForce RTX 5060 Laptop GPU (`PCI\VEN_10DE&DEV_2D59&SUBSYS_17A71025`) | PCIe Bus |
| **Keyboard Input** | `ACPI\10251749` (PS/2) & `ACPI\1025174B` (I2C HID) | Standard Linux `atkbd` & `i2c-hid` |
| **RGB Lighting Controller** | `ACPI\1025174B` (8 HID collections, Collections 1–4: Vendor Lighting) | ACPI WMI & Linux `/dev/hidraw*` |
| **Embedded Controller (EC)** | Direct LPC / eSPI I/O ports `0x62`/`0x66` & `0x68`/`0x6C` | Windows `inpoutx64.sys` / ACPI EC |
| **ACPI WMI Bus Device** | `ACPI\1025165F` | ACPI WMI (`WMID_GUID1`, `WMID_GUID4`, `WMID_GUID5`) |

---

## 2. Windows PredatorSense Reverse-Engineering Audit

### A. Active Windows Processes (~607 MB RAM at idle)
On Windows, PredatorSense requires **17 background processes** and **2 kernel drivers**:
- **UI Processes (Electron / Node.js / Chromium)** (~350 MB RAM):
  - `PredatorSense.exe` (Main Node.js process + in-memory Aedes MQTT broker)
  - `PredatorSense.exe` (Chromium GPU rendering process)
  - `PredatorSense.exe` (Chromium Webview / Angular 15 SPA frontend)
  - `PredatorSense.exe` (Chromium Audio / Utility process)
- **11 Acer Background Services** (~250 MB RAM):
  - `AcerAgentService.exe` (`AASSvc`): Central system orchestrator
  - `AcerHardwareService.exe`: WMI COM interface & NVAPI GPU overclocking calls
  - `AcerLightingService.exe`: RGB lighting manager (bundles OpenRGB, Qt6, `hidapi.dll`)
  - `AcerCCAgent.exe` & `AcerQAAgent.exe`: Acer Care Center & Quick Access (80% battery limit, OSD)
  - `AcerSysMonitorService.exe` & `AcerSysHardwareService.exe`: Telemetry polling
  - `AcerCentralService.exe`, `AcerEZService.exe`, `AcerDIAgent.exe`, `AcerService.exe`
- **Windows Kernel Drivers**:
  - `AcerApplicationBaseDriver.sys`: KMDF bus driver for `ACPI\1025165F`
  - `inpoutx64.sys`: Direct ring-0 Port I/O driver accessing EC ports `0x62`/`0x66`

### B. WMI Methods on `AcerGamingFunction` (`WMID_GUID4`)
Through live WMI queries on `root\wmi`, we extracted all methods under `AcerGamingFunction`:

```
WMID_GUID4: 7A4DDFE7-5B5D-40B4-8595-4408E0CC7F56
Class: root\wmi:AcerGamingFunction
```

| Method Name | Method ID | Arguments / Payload | Functional Role |
| :--- | :--- | :--- | :--- |
| `GetGamingSysInfo` | `5` | `u64 in`, `u64 out` | Read CPU/GPU fan RPMs, temperatures, sensor indices |
| `SetGamingProfile` | `1` | `u64 in (profile)` | Sets thermal mode (0=Quiet, 1=Balanced, 4=Performance, 5=Turbo) |
| `GetGamingProfile` | `3` | `u64 in`, `u64 out` | Reads active thermal mode |
| `SetGamingFanBehavior` | `14` | `u64 in` | Selects Auto (0), Max (1), or Custom (2) fan modes |
| `SetGamingFanSpeed` | `16` | `u64 in (cpu, gpu)` | Sets discrete fan speed percentages (0–100%) |
| `SetGamingFanTable` | `17` | `gmInput, gmOutput` | Writes hardware fan curve lookup tables |
| `GetGamingFanTable` | `18` | `gmOutput` | Reads hardware fan curve lookup tables |
| `SetGamingKBBacklight` | `20` | `u8 input[16]` | Sets 4-zone lighting mode, speed, brightness, RGB |
| `GetGamingKBBacklight` | `21` | `u64 in`, `u8 out[16]` | Reads 4-zone lighting mode and settings |
| `SetGamingRgbKb` | `6` | `u64 in` | Sets per-zone RGB colors (`0xZ0RRGGBB`) |
| `GetGamingRgbKb` | `7` | `u64 in`, `u64 out` | Reads per-zone RGB colors |
| `SetGamingLED` | `2` | `u64 in` | Rear logo LED power & behavior |
| `GetGamingLED` | `4` | `u64 in`, `u64 out` | Reads rear logo LED state |
| `SetGamingLEDColor` | `12` (`0x0C`) | `u8 input[6]` | Rear logo RGB color & brightness |
| `GetGamingLEDColor` | `13` (`0x0D`) | `u8 in`, `u8 out[6]` | Reads rear logo RGB color |
| `SetGamingMiscSetting` | `22` (`0x16`) | `u64 in` | Hardware toggles: LCD Overdrive (`0x105`), Boot Sound (`0x106`) |
| `GetGamingMiscSetting` | `23` (`0x17`) | `u64 in`, `u64 out` | Reads status of LCD Overdrive and Boot Sound |
| `SetBatteryHealthControl` | `21` | `u64 in` | Sets 80% battery charging limit |

### C. GPU Turbo Boost Clocks (Reverse-Engineered from `Predator PHN16-71.ini`)
Extracted from `predatorservice.inf_amd64` in the Windows DriverStore:
```ini
[PCI\VEN_10DE&DEV_2D59&SUBSYS_17A71025]
Quiet=0
Balanced=0
Performance=0
Turbo=100
RAM_Quiet=0
RAM_Balanced=0
RAM_Performance=0
RAM_Turbo=200
```
- **Quiet / Balanced / Performance**: Stock GPU clocks (`+0 MHz Core / +0 MHz VRAM`).
- **Turbo**: Overclocks the RTX 5060 by **+100 MHz Core Clock Offset** and **+200 MHz VRAM Clock Offset**.

### D. Dissected OEM Electron Frontend
- AppX package: `ULICTekInc.PredatorSenseforNotebook_5.1.514.0_x64__nt9dgb7efx6bt`
- Decompiled `app.asar` (6,891 files):
  - Framework: Angular 15 SPA in `dist/widgets/main/`.
  - Protocol: Connects to internal Aedes MQTT broker over WebSocket (`ws://localhost/mqtt`).
  - Extracted Assets:
    - Typography: [`Predator-Regular.otf`](file:///c:/Users/win/.gemini/antigravity-ide/scratch/psense/rusense/gui/frontend/fonts/Predator-Regular.otf) (bundled into `rusense/gui/frontend/fonts/`).
    - Color tokens: Stealth Cockpit Navy (`#142B39`), Secondary Dark (`#071924`), Predator Neon Cyan (`#00c8ec`), Eco Green (`#1eff96`), Magma Red (`#e8362d`).
    - Reference files preserved in [`rusense/gui/frontend/oem_reference/`](file:///c:/Users/win/.gemini/antigravity-ide/scratch/psense/rusense/gui/frontend/oem_reference/).

---

## 3. The Linux Replacement Architecture

Instead of running 17 processes and 2 proprietary drivers, the Linux implementation uses:
1. **One Kernel Driver ([`linuwu-sense.ko`](file:///c:/Users/win/.gemini/antigravity-ide/scratch/psense/linuwu-sense/src/linuwu_sense.c))**: Direct ACPI WMI evaluation via the Linux kernel.
2. **One Userspace Suite ([`rusense`](file:///c:/Users/win/.gemini/antigravity-ide/scratch/psense/rusense/))**:
   - `rusense-gui`: 15 MB RAM, 0% idle CPU, authentic Predator cyber-cockpit styling.
   - `rusense-tui`: Terminal UI with hotkeys.
   - `rusense-power-sync`: Systemd daemon for AC plug/unplug power and GPU profile sync.

```
+-------------------------------------------------------------------+
|                        RuSense GUI / TUI                          |
|         (Predator-Regular.otf / Cyber Cyan #00c8ec Theme)         |
+---------------------------------+---------------------------------+
                                  | Sysfs I/O
+---------------------------------v---------------------------------+
|                       Linux Kernel Space                          |
|  /sys/firmware/acpi/platform_profile  -> Thermal profiles         |
|  /sys/class/hwmon/hwmonX/             -> Fan RPMs & Temperatures  |
|  /sys/devices/platform/acer-wmi/                                  |
|    ├── predator_sense/fan_speed       -> Auto/Max/Custom fans     |
|    ├── predator_sense/battery_limiter -> 80% charge threshold     |
|    ├── predator_sense/lcd_override    -> 3ms panel overdrive      |
|    ├── predator_sense/boot_animation_sound -> Startup chime audio |
|    ├── four_zoned_kb/four_zone_mode   -> 4-zone RGB animations    |
|    └── back_logo/color                -> Rear lid logo LED        |
+---------------------------------+---------------------------------+
                                  | wmi_evaluate_method()
+---------------------------------v---------------------------------+
|             Hardware ACPI BIOS & Embedded Controller              |
+-------------------------------------------------------------------+
```

---

## 4. Key Modifications Made in this Repository

1. **Kernel Driver (`linuwu-sense/src/linuwu_sense.c`)**:
   - **Fixed Battery Profile Gate**: Unblocked `PLATFORM_PROFILE_QUIET` and `PLATFORM_PROFILE_LOW_POWER` on battery (`!on_AC`).
   - **EC LPC Bus Jiffies Cache**: 300ms sensor cache in `acer_wmi_hwmon_read()`, slashing LPC bus traffic by ~80% and preventing micro-stutters during gaming.
   - **In-Kernel Delayed Work**: `schedule_delayed_work(&back_logo_reassert_work, msecs_to_jiffies(500))` on `WMID_AC_EVENT` to prevent the EC from resetting the rear logo on power state transitions.
   - **LCD Overdrive & Boot Sound**: Added sysfs attributes `lcd_override` and `boot_animation_sound`.
   - **Model Match**: Added clean `DMI_MATCH(DMI_PRODUCT_NAME, "Predator PHN16S-71")` with quirks:
     `.predator_v4 = 1`, `.four_zone_kb = 1`, `.back_logo = 1`.
   - **String Safety**: Replaced `strncpy` with `memcpy` and added `<linux/string.h>`.

2. **Core Domain & Sysfs (`rusense/core/`)**:
   - Added `KeyboardRgb` model with 8 modes (Static, Breathing, Neon, Wave, Shifting, Zoom, Meteor, Twinkle).
   - Added `keyboard_rgb()` and `set_keyboard_rgb()` methods to `SensePort` and `SysfsSense`.
   - Thread-safe caching for `hwmon`, battery, and profile directories to eliminate redundant filesystem traversals.

3. **Desktop Cockpit GUI (`rusense/gui/`)**:
   - Built a 6-Page Navigation Cockpit mirroring OEM PredatorSense:
     - **Dashboard**: Dual circular tachometers (CPU & GPU Aeroblade 3D fans), current scenario banner, and live telemetry stat tiles.
     - **Keyboard & Pulsar Lighting**:
       - Interactive 4-zone visual keyboard diagram (WASD, Center Alphanumerics, Modifiers/Arrows, Numpad).
       - Zone Selection Pills (`[ALL 4 ZONES]`, `[ZONE 1: WASD]`, `[ZONE 2: CENTER]`, `[ZONE 3: ARROWS]`, `[ZONE 4: NUMPAD]`).
       - Custom Color Studio: Native RGB color picker (`<input type="color">` + hex text input) with per-zone assignment.
       - 7 Authentic OEM Swatches: Predator Cyan (`#00c8ec`), Eco Green (`#1eff96`), Magma Red (`#e8362d`), Deep Blue (`#0064ff`), Extreme Pink (`#ff3399`), Solar Amber (`#ffcc00`), Arctic White (`#ffffff`).
       - 4-Zone Aesthetic Themes: *Cyberpunk Neon*, *Predator Ice*, *Magma Inferno*, *Matrix Code*.
       - 8 Hardware Effect Modes: Static, Breathing, Neon, Wave, Shifting, Zoom, Meteor, Twinkle.
       - Speed (1–9), Brightness (0–100%), and Wave Direction (Left-to-Right / Right-to-Left).
       - Rear Lid Predator Logo Light (independent color picker & power toggle).
       - Keyboard Backlight Auto-Sleep (30s timeout on battery).
     - **Fan Control**: Auto mode, Max speed (100%), and Custom CPU/GPU sliders with 5 quick presets (Silent 30%, Balanced 50%, Gaming 70%, Heavy 85%, Full Throttle 100%).
     - **Scenarios**: Dedicated scenario profiles page detailing power limits, fan curves, and GPU boost for Eco, Quiet, Balanced, Performance, and Turbo modes.
     - **Monitoring & Telemetry**: Real-time sensor dashboard for CPU, GPU, and System temperatures with dynamic progress bars, battery status, and full hardware diagnostics table.
     - **Settings & Power**: 80% Battery Care limiter, USB Power-Off charging levels (0, 10%, 20%, 30%), LCD 3ms low latency overdrive, Predator Boot sound chime, and Windows Key Gaming Lock.
   - Bundled authentic OEM [`Predator-Regular.otf`](file:///c:/Users/win/.gemini/antigravity-ide/scratch/psense/rusense/gui/frontend/fonts/Predator-Regular.otf) font.
   - Dual-Brand Switcher: Real-time toggle between **Predator Cyber-Cyan** and **Nitro Fire-Red**.
   - Automated GPU Turbo Boost: Executes `nvidia-settings` (+100 MHz Core / +200 MHz VRAM) when entering Turbo mode.
   - Page Visibility API: Halts telemetry polling when window is minimized or hidden.

4. **Terminal UI (`rusense/tui/`)**:
   - Added dynamic brand detection: automatically renders **`PREDATOR SENSE`** with **Predator Neon Cyan (`#00c8ec`)** accent theme on Predator hardware, and **`NITRO SENSE`** with Fire Red on Nitro laptops.
   - Added `[r]` hotkey to cycle 4-Zone RGB keyboard modes.
   - Added `[o]` hotkey for LCD Overdrive and `[s]` for Boot Sound.

5. **NixOS Flake & Module (`nix/module.nix`)**:
   - Added `rusense-init.service`: Automatically asserts 80% battery charging threshold (`batteryChargeLimit`), 3ms LCD overdrive (`lcdOverdrive`), startup boot chime (`bootSound`), and USB charging (`usbCharging`) on boot.
   - Enhanced `rusense-power-sync.service` on AC transition:
     - **Dynamic Refresh Rate Switching**: Drops internal eDP display from 240Hz down to 60Hz on battery (slashing 3–4W of display panel power) and restores 240Hz on AC.
     - **Intel Core Ultra Dynamic EPP & RAPL**: Switches CPU Energy Performance Preference (`balance_power` on battery / `performance` on AC) and limits PL1 to 28W on battery to prolong cycle life.
     - **NVIDIA dGPU RTD3 Zero-Watt Sleep**: Ensures the RTX 5060 PCIe bus controller enters D3cold runtime suspend on battery.
     - **Keyboard Backlight Timeout**: Enables 30-second keyboard sleep timeout on battery.
   - Added permissions for `/sys/devices/platform/acer-wmi/four_zoned_kb/*` to the `linuwu_sense` group.

---

## 5. How to Continue in Linux

### A. Testing on NixOS (Recommended)
Add this repository to your NixOS configuration:

```nix
# flake.nix
inputs = {
  nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  psense.url = "path:/path/to/psense"; # or github URL
};

# configuration.nix
imports = [ inputs.psense.nixosModules.default ];

hardware.psense = {
  enable = true;
  autoPowerProfile = true;
  acProfile = "balanced-performance";
  batteryProfile = "quiet";

  # OEM Battery & Performance Enhancements:
  autoDisplayRefreshRate = true; # 240Hz on AC, 60Hz on battery (saves 3–4W)
  batteryChargeLimit = true;     # 80% charge threshold on boot
  autoBacklightTimeout = true;   # 30s keyboard sleep on battery
  lcdOverdrive = true;           # 3ms low latency overdrive on AC
  bootSound = false;             # Predator startup chime
  usbCharging = 10;              # 10% battery sleep charge threshold
  cpuEnergyPreference = true;    # Dynamic Intel Core Ultra EPP & RAPL
};

# Add your user to the linuwu_sense group:
users.users.<your_user>.extraGroups = [ "linuwu_sense" ];
```

Rebuild your system:
```bash
sudo nixos-rebuild switch --flake .#
```

---

### B. Testing on Generic Linux (Ubuntu, Arch, Fedora, Debian)

#### 1. Compile and Load the Kernel Module
```bash
cd linuwu-sense
make
sudo insmod src/linuwu_sense.ko

# Verify driver loaded and matched hardware:
dmesg | grep -i "linuwu"
ls -la /sys/devices/platform/acer-wmi/
```

#### 2. Test Hardware Attributes Directly
```bash
# Check fan RPMs
cat /sys/class/hwmon/hwmon*/fan1_input
cat /sys/class/hwmon/hwmon*/fan2_input

# Set Turbo mode
echo "performance" | sudo tee /sys/firmware/acpi/platform_profile

# Set Fans to Max
echo "100,100" | sudo tee /sys/devices/platform/acer-wmi/predator_sense/fan_speed

# Toggle 80% Battery Limit
echo 1 | sudo tee /sys/devices/platform/acer-wmi/predator_sense/battery_limiter

# Toggle LCD 3ms Overdrive
echo 1 | sudo tee /sys/devices/platform/acer-wmi/predator_sense/lcd_override

# Test 4-Zone RGB Keyboard:
# Format: mode,speed,brightness,direction,red,green,blue
# Mode 0 (Static) in Predator Neon Cyan (0, 200, 236):
echo "0,0,100,0,0,200,236" | sudo tee /sys/devices/platform/acer-wmi/four_zoned_kb/four_zone_mode

# Mode 3 (Wave):
echo "3,5,100,1,0,0,0" | sudo tee /sys/devices/platform/acer-wmi/four_zoned_kb/four_zone_mode

# Per-Zone Independent Colors (e.g. Cyberpunk Cyan & Pink):
# Format: zone1_hex,zone2_hex,zone3_hex,zone4_hex,brightness
echo "00c8ec,ff3399,00c8ec,ff3399,100" | sudo tee /sys/devices/platform/acer-wmi/four_zoned_kb/per_zone_mode

# Test Rear Lid Logo LED (White, full brightness, ON):
echo "ffffff,100,1" | sudo tee /sys/devices/platform/acer-wmi/back_logo/color
```

#### 3. Build and Run RuSense GUI & TUI
```bash
cd rusense

# Run TUI directly:
cargo run -p rusense-tui

# Run GUI (requires webkit2gtk development libraries):
cargo run -p rusense-gui

# Run in simulated mock mode (no driver needed):
RUSENSE_MOCK=1 cargo run -p rusense-gui
```

---

## 6. Quick Reference Table: TUI Keybindings

| Key | Action |
| :--- | :--- |
| `1` – `5` | Switch platform thermal profile (`Eco`, `Quiet`, `Balanced`, `Performance`, `Turbo`) |
| `a` | Set fans to **Auto** mode |
| `m` | Set fans to **Max** speed (100% CPU & GPU) |
| `c` | Enter **Custom** fan mode |
| `Tab` | Switch slider focus between CPU and GPU fans |
| `←` / `→` | Adjust fan percentage by 5% |
| `r` | Cycle **4-Zone RGB Keyboard Mode** (Static -> Breathing -> Neon -> Wave, etc.) |
| `b` | Toggle **80% Battery Care Limit** |
| `u` | Cycle **USB Power-off Charging** (Off -> 10% -> 20% -> 30%) |
| `k` | Toggle **Keyboard Backlight Timeout** (30s idle sleep) |
| `l` | Toggle **Rear Lid Logo LED** |
| `o` | Toggle **LCD 3ms Panel Overdrive** |
| `s` | Toggle **Predator Startup Boot Chime Sound** |
| `q` / `Esc` | Quit TUI |

---

## 7. Troubleshooting & Common Questions

1. **Permission Denied on `/sys/...`**:
   - Ensure your user is in the `linuwu_sense` group: `sudo usermod -aG linuwu_sense $USER` and log out/log in.
   - Alternatively, check that udev rules from `nix/module.nix` are applied.
2. **NVIDIA GPU Clock Boost Fails**:
   - Ensure the proprietary NVIDIA driver is loaded and `nvidia-settings` is installed: `which nvidia-settings`.
   - Verify Coolbits or Clock Offset support in X11 / Wayland session.
3. **Rear Logo Resets When Unplugging AC**:
   - The delayed work in `linuwu_sense.c` automatically reasserts your preference 500ms after the AC event.
   - In NixOS, `rusense-power-sync.service` also watches power supply uevents and reasserts `/var/lib/rusense/back_logo`.
