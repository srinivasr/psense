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
      ACTION=="add", SUBSYSTEM=="platform", KERNEL=="acer-wmi", RUN+="${pkgs.runtimeShell} -c 'for d in /sys/devices/platform/acer-wmi/nitro_sense /sys/devices/platform/acer-wmi/predator_sense /sys/devices/platform/acer-wmi/platform-profile /sys/devices/platform/acer-wmi/back_logo; do [ -d $$d ] && { chgrp -R linuwu_sense $$d; chmod -R g+w $$d; }; done; exit 0'"
      SUBSYSTEM=="power_supply", KERNEL=="ACAD", ACTION=="change", RUN+="${pkgs.systemd}/bin/systemctl --no-block restart rusense-backlogo-sync.service"
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

      # Keyboard configurations
      "z /sys/module/linuwu_sense/drivers/platform:acer-wmi/acer-wmi/four_zoned_kb/four_zone_mode 0660 root linuwu_sense - -"
      "z /sys/module/linuwu_sense/drivers/platform:acer-wmi/acer-wmi/four_zoned_kb/per_zone_mode 0660 root linuwu_sense - -"

      # Back logo/lightbar LED control
      "z /sys/module/linuwu_sense/drivers/platform:acer-wmi/acer-wmi/back_logo/color 0660 root linuwu_sense - -"
      "z /sys/devices/platform/acer-wmi/back_logo/color 0660 root linuwu_sense - -"
    ];

    # Re-assert rear light preference upon AC transition when the EC resets the hardware LED
    systemd.services.rusense-backlogo-sync = {
      description = "Synchronize RuSense rear logo state on AC power state change";
      unitConfig = {
        StartLimitIntervalSec = 0;
      };
      serviceConfig = {
        Type = "oneshot";
        ExecStart = pkgs.writeShellScript "rusense-backlogo-sync" ''
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

            # The Acer Predator Embedded Controller (EC) takes ~1-2 seconds to complete
            # its AC plug/unplug power transition and fan mode change, during which it resets
            # the rear logo LED to ON. Re-assert the user's desired state across this window.
            for delay in 0.1 0.4 0.8 1.2 1.8 2.5; do
              sleep "$delay"
              echo "$TARGET" > "$SYSFS_COLOR"
            done
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
