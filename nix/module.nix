self:
{ config, lib, pkgs, ... }:

let
  cfg = config.hardware.psense;
in {
  options.hardware.psense = {
    enable = lib.mkEnableOption "Acer Predator/Nitro hardware management via psense (kernel driver and RuSense GUI/TUI)";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      defaultText = lib.literalExpression "inputs.psense.packages.\${pkgs.stdenv.hostPlatform.system}.default";
      description = "The RuSense package (GUI + TUI) to install.";
    };

    manageGroup = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Whether to create the linuwu_sense user group for unprivileged hardware sysfs control.";
    };

    autoPowerProfile = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Automatically switch thermal profiles and GPU boost states when transitioning between AC power and battery.";
    };

    batteryProfile = lib.mkOption {
      type = lib.types.enum [ "low-power" "quiet" "balanced" ];
      default = "quiet";
      description = "The platform thermal profile to activate when running on battery power.";
    };

    acProfile = lib.mkOption {
      type = lib.types.enum [ "balanced" "balanced-performance" "performance" ];
      default = "balanced-performance";
      description = "The platform thermal profile to activate when plugged into AC power.";
    };

    autoDisplayRefreshRate = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Automatically drop display refresh rate to 60Hz on battery and restore high refresh (240Hz/165Hz) on AC.";
    };

    batteryChargeLimit = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Enable 80% battery charging threshold limit on boot to prevent battery wear.";
    };

    autoBacklightTimeout = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Automatically enable 30s keyboard backlight sleep timeout on battery.";
    };

    lcdOverdrive = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Enable 3ms LCD overdrive on AC power for minimal panel pixel latency.";
    };

    bootSound = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Enable Predator startup chime and boot animation sound.";
    };

    usbCharging = lib.mkOption {
      type = lib.types.enum [ 0 10 20 30 ];
      default = 10;
      description = "USB power-off charging battery threshold percentage (0 to disable, 10, 20, 30%).";
    };

    cpuEnergyPreference = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Tune Intel Core Ultra energy performance preference (EPP) dynamically between AC and battery.";
    };
  };

  config = lib.mkIf cfg.enable {
    # Build and load linuwu_sense for the active kernel
    boot.extraModulePackages = [
      (config.boot.kernelPackages.callPackage ./linuwu-sense.nix {})
    ];
    boot.kernelModules = [ "linuwu_sense" ];
    boot.blacklistedKernelModules = [ "acer_wmi" ];

    # Dedicated group for hardware sysfs control without full root/wheel rights
    users.groups = lib.mkIf cfg.manageGroup {
      linuwu_sense = {};
    };

    # Install RuSense into system environment
    environment.systemPackages = [ cfg.package ];

    # RuSense / linuwu_sense udev permissions for acer-wmi sysfs controls
    # and trigger sync service when AC power adapter is plugged/unplugged
    services.udev.extraRules = ''
      ACTION=="add", SUBSYSTEM=="platform", KERNEL=="acer-wmi", RUN+="${pkgs.runtimeShell} -c 'for d in /sys/devices/platform/acer-wmi/nitro_sense /sys/devices/platform/acer-wmi/predator_sense /sys/devices/platform/acer-wmi/platform-profile /sys/devices/platform/acer-wmi/back_logo /sys/devices/platform/acer-wmi/four_zoned_kb; do [ -d $$d ] && { chgrp -R linuwu_sense $$d; chmod -R g+w $$d; }; done; exit 0'"
      SUBSYSTEM=="power_supply", KERNEL=="ACAD|AC|ADP*", ACTION=="change", RUN+="${pkgs.systemd}/bin/systemctl --no-block restart rusense-power-sync.service"
    '';

    systemd.tmpfiles.rules = [
      # State directory for RuSense persistent settings
      "d /var/lib/rusense 0775 root linuwu_sense - -"

      # General Predator/Nitro parameters
      "z /sys/module/linuwu_sense/drivers/platform:acer-wmi/acer-wmi/*/fan_speed 0660 root linuwu_sense - -"
      "z /sys/module/linuwu_sense/drivers/platform:acer-wmi/acer-wmi/*/battery_limiter 0660 root linuwu_sense - -"
      "z /sys/module/linuwu_sense/drivers/platform:acer-wmi/acer-wmi/*/battery_calibration 0660 root linuwu_sense - -"
      "z /sys/module/linuwu_sense/drivers/platform:acer-wmi/acer-wmi/*/usb_charging 0660 root linuwu_sense - -"
      "z /sys/module/linuwu_sense/drivers/platform:acer-wmi/acer-wmi/*/backlight_timeout 0660 root linuwu_sense - -"
      "z /sys/module/linuwu_sense/drivers/platform:acer-wmi/acer-wmi/*/boot_animation_sound 0660 root linuwu_sense - -"
      "z /sys/module/linuwu_sense/drivers/platform:acer-wmi/acer-wmi/*/lcd_override 0660 root linuwu_sense - -"

      # Direct sysfs paths used by RuSense
      "z /sys/devices/platform/acer-wmi/predator_sense/* 0660 root linuwu_sense - -"
      "z /sys/devices/platform/acer-wmi/nitro_sense/* 0660 root linuwu_sense - -"
      "z /sys/devices/platform/acer-wmi/platform-profile/*/* 0660 root linuwu_sense - -"
      "z /sys/devices/platform/acer-wmi/back_logo/* 0660 root linuwu_sense - -"
      "z /sys/devices/platform/acer-wmi/four_zoned_kb/* 0660 root linuwu_sense - -"

      # Keyboard configurations
      "z /sys/module/linuwu_sense/drivers/platform:acer-wmi/acer-wmi/four_zoned_kb/four_zone_mode 0660 root linuwu_sense - -"
      "z /sys/module/linuwu_sense/drivers/platform:acer-wmi/acer-wmi/four_zoned_kb/per_zone_mode 0660 root linuwu_sense - -"

      # Back logo/lightbar LED control
      "z /sys/module/linuwu_sense/drivers/platform:acer-wmi/acer-wmi/back_logo/color 0660 root linuwu_sense - -"
      "z /sys/devices/platform/acer-wmi/back_logo/color 0660 root linuwu_sense - -"
    ];

    # Hardware boot initialization service for persistent OEM features
    systemd.services.rusense-init = {
      description = "Initialize Acer Predator hardware settings (battery care, LCD overdrive, boot sound)";
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        ExecStart = pkgs.writeShellScript "rusense-init" ''
          for dir in /sys/devices/platform/acer-wmi/predator_sense /sys/devices/platform/acer-wmi/nitro_sense; do
            if [ -d "$dir" ]; then
              ${lib.optionalString cfg.batteryChargeLimit ''
                [ -w "$dir/battery_limiter" ] && echo 1 > "$dir/battery_limiter" 2>/dev/null || true
              ''}
              ${lib.optionalString cfg.lcdOverdrive ''
                [ -w "$dir/lcd_override" ] && echo 1 > "$dir/lcd_override" 2>/dev/null || true
              ''}
              [ -w "$dir/boot_animation_sound" ] && echo "${if cfg.bootSound then "1" else "0"}" > "$dir/boot_animation_sound" 2>/dev/null || true
              [ -w "$dir/usb_charging" ] && echo "${toString cfg.usbCharging}" > "$dir/usb_charging" 2>/dev/null || true
              break
            fi
          done
        '';
      };
    };

    # Re-assert rear light and optimize power state upon AC transition
    systemd.services.rusense-power-sync = {
      description = "Synchronize RuSense power profile, EPP, dGPU RTD3, and refresh rate on AC transition";
      unitConfig = {
        StartLimitIntervalSec = 0;
      };
      serviceConfig = {
        Type = "oneshot";
        ExecStart = pkgs.writeShellScript "rusense-power-sync" ''
          # 1. Detect AC status
          AC_ONLINE=1
          for ac in /sys/class/power_supply/AC* /sys/class/power_supply/ADP*; do
            if [ -f "$ac/online" ]; then
              AC_ONLINE=$(cat "$ac/online" 2>/dev/null || echo 1)
              break
            fi
          done

          # 2. Automatic thermal profile & GPU boost transition
          ${lib.optionalString cfg.autoPowerProfile ''
            PROFILE_NODE="/sys/firmware/acpi/platform_profile"
            [ ! -w "$PROFILE_NODE" ] && PROFILE_NODE="/sys/devices/platform/acer-wmi/platform-profile/platform-profile-0/profile"

            if [ "$AC_ONLINE" = "0" ]; then
              # On Battery: apply battery profile (quiet/low-power) and reset GPU offsets
              [ -w "$PROFILE_NODE" ] && echo "${cfg.batteryProfile}" > "$PROFILE_NODE" 2>/dev/null || true
              if command -v nvidia-settings >/dev/null 2>&1; then
                nvidia-settings -a [gpu:0]/GPUGraphicsClockOffsetAllPerformanceLevels=0 -a [gpu:0]/GPUMemoryTransferRateOffsetAllPerformanceLevels=0 >/dev/null 2>&1 || true
              fi

              # Optimize dGPU PCI runtime power management (RTD3) to 0W idle on battery
              for pci_dev in /sys/bus/pci/devices/*; do
                if [ -f "$pci_dev/vendor" ] && [ "$(cat "$pci_dev/vendor" 2>/dev/null)" = "0x10de" ]; then
                  [ -w "$pci_dev/power/control" ] && echo auto > "$pci_dev/power/control" 2>/dev/null || true
                fi
              done

              # Battery keyboard backlight sleep timeout
              ${lib.optionalString cfg.autoBacklightTimeout ''
                for b_timeout in /sys/devices/platform/acer-wmi/predator_sense/backlight_timeout /sys/devices/platform/acer-wmi/nitro_sense/backlight_timeout; do
                  [ -w "$b_timeout" ] && echo 1 > "$b_timeout" 2>/dev/null || true
                done
              ''}

              # CPU Energy Performance Preference (EPP): balance_power on battery
              ${lib.optionalString cfg.cpuEnergyPreference ''
                for epp in /sys/devices/system/cpu/cpu*/cpufreq/energy_performance_preference /sys/devices/system/cpu/cpu*/power/energy_performance_preference; do
                  [ -w "$epp" ] && echo "balance_power" > "$epp" 2>/dev/null || true
                done
                for rapl in /sys/class/powercap/intel-rapl/intel-rapl:0/constraint_0_power_limit_uw; do
                  [ -w "$rapl" ] && echo "28000000" > "$rapl" 2>/dev/null || true # 28W PL1 on battery
                done
              ''}

              # Screen refresh rate: drop eDP to 60Hz to conserve battery
              ${lib.optionalString cfg.autoDisplayRefreshRate ''
                for u_home in /home/*; do
                  u_id=$(stat -c '%u' "$u_home" 2>/dev/null || true)
                  [ -z "$u_id" ] && continue
                  if [ -e "/tmp/.X11-unix/X0" ] && command -v xrandr >/dev/null 2>&1; then
                    DISPLAY=:0 XAUTHORITY="$u_home/.Xauthority" xrandr --output eDP-1 --rate 60 2>/dev/null || true
                  fi
                done
              ''}
            else
              # On AC: restore AC profile
              [ -w "$PROFILE_NODE" ] && echo "${cfg.acProfile}" > "$PROFILE_NODE" 2>/dev/null || true
              if [ "${cfg.acProfile}" = "performance" ] && command -v nvidia-settings >/dev/null 2>&1; then
                nvidia-settings -a [gpu:0]/GPUGraphicsClockOffsetAllPerformanceLevels=100 -a [gpu:0]/GPUMemoryTransferRateOffsetAllPerformanceLevels=200 >/dev/null 2>&1 || true
              fi

              # CPU Energy Performance Preference (EPP): balance_performance / performance on AC
              ${lib.optionalString cfg.cpuEnergyPreference ''
                for epp in /sys/devices/system/cpu/cpu*/cpufreq/energy_performance_preference /sys/devices/system/cpu/cpu*/power/energy_performance_preference; do
                  [ -w "$epp" ] && echo "${if cfg.acProfile == "performance" then "performance" else "balance_performance"}" > "$epp" 2>/dev/null || true
                done
                if [ "${cfg.acProfile}" = "performance" ]; then
                  for rapl in /sys/class/powercap/intel-rapl/intel-rapl:0/constraint_0_power_limit_uw; do
                    [ -w "$rapl" ] && echo "65000000" > "$rapl" 2>/dev/null || true # 65W PL1 on AC performance
                  done
                fi
              ''}

              # Screen refresh rate: restore native high refresh (240Hz / auto) on AC
              ${lib.optionalString cfg.autoDisplayRefreshRate ''
                for u_home in /home/*; do
                  u_id=$(stat -c '%u' "$u_home" 2>/dev/null || true)
                  [ -z "$u_id" ] && continue
                  if [ -e "/tmp/.X11-unix/X0" ] && command -v xrandr >/dev/null 2>&1; then
                    DISPLAY=:0 XAUTHORITY="$u_home/.Xauthority" xrandr --output eDP-1 --auto 2>/dev/null || true
                  fi
                done
              ''}
            fi
          ''}

          # 3. Synchronize rear logo lighting preference
          STATE_FILE="/var/lib/rusense/back_logo"
          if [ ! -f "$STATE_FILE" ]; then
            for f in /home/*/.local/state/rusense/back_logo; do
              if [ -f "$f" ]; then
                STATE_FILE="$f"
                break
              fi
            done
          fi
          SYSFS_COLOR="/sys/devices/platform/acer-wmi/back_logo/color"
          if [ -f "$STATE_FILE" ] && [ -w "$SYSFS_COLOR" ]; then
            DESIRED=$(cat "$STATE_FILE" | tr -d '[:space:]')
            if [ "$DESIRED" = "0" ]; then
              TARGET="ffffff,0,0"
            elif [ "$DESIRED" = "1" ]; then
              TARGET="ffffff,100,1"
            else
              exit 0
            fi

            # The linuwu-sense kernel driver handles in-kernel delayed re-assertion on
            # AC transitions. A single write from userspace ensures driver preference sync
            # without wasteful multi-sleep process spawning.
            echo "$TARGET" > "$SYSFS_COLOR" 2>/dev/null || true
          fi
        '';
      };
    };

    # Cleanly unload linuwu_sense at shutdown
    systemd.services.linuwu-sense-unload = {
      description = "Unload linuwu_sense at shutdown";
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        ExecStop = "${pkgs.kmod}/bin/rmmod linuwu_sense";
      };
    };
  };
}
