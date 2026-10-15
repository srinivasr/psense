//! DTOs and command logic for the Tauri bridge.
//!
//! The free functions here take `&dyn SensePort` / `&mut dyn SensePort`,
//! so every behavior is unit-testable against [`MockSense`] without a
//! Tauri runtime; the `#[tauri::command]` wrappers in `main.rs` stay one
//! line each. Errors cross the bridge as the PT-BR [`SenseError`] Display
//! strings — the frontend shows them verbatim in the toast.
//!
//! [`MockSense`]: rusense_core::MockSense

use rusense_core::{
    Capabilities, FanDuty, FanMode, KeyboardRgb, PowerSettings, SenseError, SensePort, Telemetry,
    UsbChargeLevel,
};
use serde::{Deserialize, Serialize};

/// Everything the frontend needs to paint one frame of the cockpit.
#[derive(Debug, Clone, Serialize)]
pub struct UiState {
    pub telemetry: TelemetryDto,
    pub profiles: ProfilesDto,
    pub fan: FanDto,
    pub power: PowerDto,
    pub keyboard_rgb: KeyboardRgbDto,
    pub caps: CapsDto,
    /// True when running against the mock backend (`--mock` / `RUSENSE_MOCK=1`).
    pub mock: bool,
}

/// Live sensor readings.
#[derive(Debug, Clone, Serialize)]
pub struct TelemetryDto {
    pub cpu_rpm: u32,
    pub gpu_rpm: u32,
    /// `[cpu, gpu, system]` in °C.
    pub temps: [f32; 3],
    pub battery_pct: u8,
    pub battery_status: String,
}

/// Available platform profiles and the active one, by name.
#[derive(Debug, Clone, Serialize)]
pub struct ProfilesDto {
    pub available: Vec<String>,
    pub active: String,
}

/// Fan mode flattened for the frontend: `"auto"` / `"max"` / `"custom"`
/// plus the duty pair (aliased to `0,0` and `100,100` for auto/max).
#[derive(Debug, Clone, Serialize)]
pub struct FanDto {
    pub mode: String,
    pub cpu: u8,
    pub gpu: u8,
}

/// Power-related toggles.
#[derive(Debug, Clone, Serialize)]
pub struct PowerDto {
    pub limiter: bool,
    pub usb: u8,
    pub backlight: bool,
    pub logo: bool,
    pub lcd_override: bool,
    pub boot_sound: bool,
}

/// 4-zone RGB keyboard configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyboardRgbDto {
    pub mode: u8,
    pub speed: u8,
    pub brightness: u8,
    pub direction: u8,
    pub red: u8,
    pub green: u8,
    pub blue: u8,
}

impl From<KeyboardRgb> for KeyboardRgbDto {
    fn from(k: KeyboardRgb) -> Self {
        Self {
            mode: k.mode,
            speed: k.speed,
            brightness: k.brightness,
            direction: k.direction,
            red: k.red,
            green: k.green,
            blue: k.blue,
        }
    }
}

/// Feature groups the backend supports; the frontend hides absent cards.
#[derive(Debug, Clone, Serialize)]
pub struct CapsDto {
    pub fan_control: bool,
    pub power: bool,
    pub four_zone_kb: bool,
    pub back_logo: bool,
    pub lcd_override: bool,
    pub boot_sound: bool,
}

fn err_str(e: SenseError) -> String {
    e.to_string()
}

impl From<Telemetry> for TelemetryDto {
    fn from(t: Telemetry) -> Self {
        Self {
            cpu_rpm: t.fan_cpu_rpm,
            gpu_rpm: t.fan_gpu_rpm,
            temps: t.temps,
            battery_pct: t.battery_pct,
            battery_status: t.battery_status,
        }
    }
}

impl From<FanMode> for FanDto {
    fn from(m: FanMode) -> Self {
        match m {
            FanMode::Auto => Self {
                mode: "auto".into(),
                cpu: 0,
                gpu: 0,
            },
            FanMode::Max => Self {
                mode: "max".into(),
                cpu: 100,
                gpu: 100,
            },
            FanMode::Custom { cpu, gpu } => Self {
                mode: "custom".into(),
                cpu: cpu.get(),
                gpu: gpu.get(),
            },
        }
    }
}

impl From<PowerSettings> for PowerDto {
    fn from(p: PowerSettings) -> Self {
        Self {
            limiter: p.limiter,
            usb: p.usb.get(),
            backlight: p.backlight_timeout,
            logo: false,
            lcd_override: p.lcd_override,
            boot_sound: p.boot_sound,
        }
    }
}

impl From<Capabilities> for CapsDto {
    fn from(c: Capabilities) -> Self {
        Self {
            fan_control: c.fan_control,
            power: c.power,
            four_zone_kb: c.four_zone_kb,
            back_logo: c.back_logo,
            lcd_override: c.lcd_override,
            boot_sound: c.boot_sound,
        }
    }
}

/// Read the full UI state from the port. Fan mode and power are only read
/// when the matching capability is present (mirroring the TUI): without it
/// the sysfs files are absent and the read would fail, and the frontend
/// hides those cards anyway.
pub fn read_state(port: &dyn SensePort, mock: bool) -> Result<UiState, String> {
    let caps = port.capabilities();
    let telemetry = port.telemetry().map_err(err_str)?.into();
    let profiles = port.profiles().map_err(err_str)?;
    let fan = if caps.fan_control {
        port.fan_mode().map_err(err_str)?.into()
    } else {
        FanDto::from(FanMode::Auto)
    };
    let logo = if caps.back_logo {
        port.back_logo().unwrap_or(false)
    } else {
        false
    };
    let mut power = if caps.power {
        PowerDto::from(port.power().map_err(err_str)?)
    } else {
        PowerDto {
            limiter: false,
            usb: 0,
            backlight: false,
            logo: false,
            lcd_override: false,
            boot_sound: false,
        }
    };
    power.logo = logo;
    let keyboard_rgb = if caps.four_zone_kb {
        port.keyboard_rgb().unwrap_or_default().into()
    } else {
        KeyboardRgb::default().into()
    };
    Ok(UiState {
        telemetry,
        profiles: ProfilesDto {
            available: profiles
                .available
                .iter()
                .map(|p| p.as_str().to_string())
                .collect(),
            active: profiles.active.as_str().to_string(),
        },
        fan,
        power,
        keyboard_rgb,
        caps: caps.into(),
        mock,
    })
}

/// Apply 4-zone keyboard RGB configuration.
pub fn apply_keyboard_rgb(
    port: &mut dyn SensePort,
    mode: u8,
    speed: u8,
    brightness: u8,
    direction: u8,
    red: u8,
    green: u8,
    blue: u8,
) -> Result<(), String> {
    let rgb = KeyboardRgb {
        mode,
        speed,
        brightness,
        direction,
        red,
        green,
        blue,
    };
    port.set_keyboard_rgb(&rgb).map_err(err_str)
}

/// Apply per-zone keyboard RGB colors (hex formatted zones 1-4).
pub fn apply_per_zone_rgb(
    port: &mut dyn SensePort,
    z1: &str,
    z2: &str,
    z3: &str,
    z4: &str,
    brightness: u8,
) -> Result<(), String> {
    port.set_per_zone_rgb(z1, z2, z3, z4, brightness).map_err(err_str)
}

/// Resolve `name` against the port's available profiles and activate it.
pub fn apply_profile(port: &mut dyn SensePort, name: &str) -> Result<(), String> {
    let profile = port
        .profiles()
        .map_err(err_str)?
        .available
        .into_iter()
        .find(|p| p.as_str() == name)
        .ok_or_else(|| err_str(SenseError::UnknownProfile(name.to_string())))?;
    port.set_profile(&profile).map_err(err_str)?;

    // OEM PredatorSense GPU Boost parity:
    // If Turbo ("performance") is selected, boost GPU (+100MHz Core, +200MHz VRAM); otherwise reset to 0.
    apply_gpu_turbo_boost(name == "performance");

    Ok(())
}

fn apply_gpu_turbo_boost(enable: bool) {
    let (core, mem) = if enable { (100, 200) } else { (0, 0) };
    let _ = std::process::Command::new("nvidia-settings")
        .args([
            "-a",
            &format!("[gpu:0]/GPUGraphicsClockOffsetAllPerformanceLevels={core}"),
            "-a",
            &format!("[gpu:0]/GPUMemoryTransferRateOffsetAllPerformanceLevels={mem}"),
        ])
        .output();
}

/// Apply a fan mode from its frontend encoding (`"auto"`/`"max"`/`"custom"`).
/// Duties are only meaningful for `"custom"` and validated by [`FanDuty`].
pub fn apply_fan(port: &mut dyn SensePort, mode: &str, cpu: u8, gpu: u8) -> Result<(), String> {
    let mode = match mode {
        "auto" => FanMode::Auto,
        "max" => FanMode::Max,
        "custom" => FanMode::custom(
            FanDuty::new(cpu).map_err(err_str)?,
            FanDuty::new(gpu).map_err(err_str)?,
        ),
        other => return Err(format!("invalid fan mode: {other}")),
    };
    port.set_fan_mode(mode).map_err(err_str)
}

/// Apply the power toggles. `usb` is validated by [`UsbChargeLevel`]
/// (0/10/20/30). On failure the port may have applied earlier fields —
/// the frontend re-polls `state` after any error.
pub fn apply_power(
    port: &mut dyn SensePort,
    limiter: bool,
    usb: u8,
    backlight: bool,
    lcd_override: bool,
    boot_sound: bool,
) -> Result<(), String> {
    let usb = UsbChargeLevel::new(usb).map_err(err_str)?;
    port.set_power(PowerSettings {
        limiter,
        usb,
        backlight_timeout: backlight,
        lcd_override,
        boot_sound,
    })
    .map_err(err_str)
}

/// Apply rear logo toggle.
pub fn apply_back_logo(port: &mut dyn SensePort, on: bool) -> Result<(), String> {
    port.set_back_logo(on).map_err(err_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusense_core::MockSense;

    #[test]
    fn apply_back_logo_toggles_state() {
        let mut mock = MockSense::new();
        assert!(!read_state(&mock, true).unwrap().power.logo);
        apply_back_logo(&mut mock, true).unwrap();
        assert!(read_state(&mock, true).unwrap().power.logo);
        apply_back_logo(&mut mock, false).unwrap();
        assert!(!read_state(&mock, true).unwrap().power.logo);
    }

    #[test]
    fn apply_keyboard_rgb_updates_state() {
        let mut mock = MockSense::new();
        apply_keyboard_rgb(&mut mock, 3, 5, 80, 1, 255, 0, 128).unwrap();
        let k = mock.keyboard_rgb().unwrap();
        assert_eq!(k.mode, 3);
        assert_eq!(k.brightness, 80);
        assert_eq!(k.red, 255);
    }

    // --- read_state / DTO mapping ---

    #[test]
    fn ui_state_maps_mock_defaults() {
        let mock = MockSense::new();
        let s = read_state(&mock, true).unwrap();

        assert_eq!(
            s.profiles.available,
            ["low-power", "quiet", "balanced", "balanced-performance"]
        );
        assert_eq!(s.profiles.active, "balanced-performance");

        assert_eq!(s.fan.mode, "auto");
        assert_eq!((s.fan.cpu, s.fan.gpu), (0, 0));

        assert!(s.power.limiter);
        assert_eq!(s.power.usb, 30);
        assert!(s.power.backlight);

        assert!(s.caps.fan_control);
        assert!(s.caps.power);
        assert!(s.caps.four_zone_kb);

        assert_eq!(s.telemetry.temps, [41.0, 35.0, 40.0]);
        assert_eq!(s.telemetry.battery_pct, 80);
        assert_eq!(s.telemetry.battery_status, "Not charging");
        assert!(s.telemetry.cpu_rpm > 0 && s.telemetry.gpu_rpm > 0);

        assert!(s.mock);
    }

    #[test]
    fn ui_state_reports_real_backend_without_mock_badge() {
        let mock = MockSense::new();
        assert!(!read_state(&mock, false).unwrap().mock);
    }

    #[test]
    fn ui_state_serializes_frontend_field_names() {
        let mock = MockSense::new();
        let v = serde_json::to_value(read_state(&mock, true).unwrap()).unwrap();
        assert_eq!(v["profiles"]["active"], "balanced-performance");
        assert_eq!(v["fan"]["mode"], "auto");
        assert_eq!(v["power"]["usb"], 30);
        assert_eq!(v["caps"]["four_zone_kb"], true);
        assert_eq!(v["telemetry"]["battery_pct"], 80);
        assert_eq!(v["mock"], true);
    }

    // --- apply_profile ---

    #[test]
    fn apply_profile_roundtrips_through_state() {
        let mut mock = MockSense::new();
        apply_profile(&mut mock, "quiet").unwrap();
        assert_eq!(read_state(&mock, true).unwrap().profiles.active, "quiet");
    }

    #[test]
    fn apply_profile_rejects_unknown_name() {
        let mut mock = MockSense::new();
        let err = apply_profile(&mut mock, "turbo").unwrap_err();
        assert_eq!(err, "unknown profile: turbo");
        // State stays untouched.
        assert_eq!(
            read_state(&mock, true).unwrap().profiles.active,
            "balanced-performance"
        );
    }

    // --- apply_fan ---

    #[test]
    fn apply_fan_custom_reaches_port_and_state() {
        let mut mock = MockSense::new();
        apply_fan(&mut mock, "custom", 50, 70).unwrap();
        assert_eq!(
            mock.fan_mode().unwrap(),
            FanMode::custom(FanDuty::new(50).unwrap(), FanDuty::new(70).unwrap())
        );
        let s = read_state(&mock, true).unwrap();
        assert_eq!(s.fan.mode, "custom");
        assert_eq!((s.fan.cpu, s.fan.gpu), (50, 70));
    }

    #[test]
    fn apply_fan_auto_and_max_ignore_duties() {
        let mut mock = MockSense::new();
        apply_fan(&mut mock, "max", 10, 20).unwrap();
        assert_eq!(mock.fan_mode().unwrap(), FanMode::Max);
        apply_fan(&mut mock, "auto", 10, 20).unwrap();
        assert_eq!(mock.fan_mode().unwrap(), FanMode::Auto);
    }

    #[test]
    fn apply_fan_custom_aliases_normalize() {
        let mut mock = MockSense::new();
        apply_fan(&mut mock, "custom", 100, 100).unwrap();
        assert_eq!(mock.fan_mode().unwrap(), FanMode::Max);
        assert_eq!(read_state(&mock, true).unwrap().fan.mode, "max");
    }

    #[test]
    fn apply_fan_rejects_unknown_mode() {
        let mut mock = MockSense::new();
        let err = apply_fan(&mut mock, "turbo", 0, 0).unwrap_err();
        assert_eq!(err, "invalid fan mode: turbo");
    }

    #[test]
    fn apply_fan_rejects_out_of_range_duty() {
        let mut mock = MockSense::new();
        let err = apply_fan(&mut mock, "custom", 150, 50).unwrap_err();
        assert_eq!(err, "value out of range 0–100: 150");
        assert_eq!(mock.fan_mode().unwrap(), FanMode::Auto);
    }

    // --- apply_power ---

    #[test]
    fn apply_power_toggles_limiter() {
        let mut mock = MockSense::new();
        apply_power(&mut mock, false, 30, true, false, false).unwrap();
        let s = read_state(&mock, true).unwrap();
        assert!(!s.power.limiter);
        assert_eq!(s.power.usb, 30);
        assert!(s.power.backlight);
        assert!(!s.power.lcd_override);
        assert!(!s.power.boot_sound);
    }

    #[test]
    fn apply_power_rejects_invalid_usb_level() {
        let mut mock = MockSense::new();
        let err = apply_power(&mut mock, true, 15, true, false, false).unwrap_err();
        assert_eq!(err, "invalid usb level (0/10/20/30): 15");
        // Nothing applied: the level is validated before touching the port.
        assert!(read_state(&mock, true).unwrap().power.limiter);
    }
}
