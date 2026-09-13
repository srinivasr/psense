{ lib, stdenv, kernel }:

stdenv.mkDerivation {
  pname = "linuwu-sense";
  version = "unstable-2026-08-20";

  src = ../linuwu-sense;

  nativeBuildInputs = kernel.moduleBuildDependencies;

  makeFlags = (builtins.filter (f:
    !(lib.hasPrefix "O=" f) && !(lib.hasPrefix "--eval" f)
  ) kernel.makeFlags) ++ [
    "KVER=${kernel.modDirVersion}"
    "KDIR=${kernel.dev}/lib/modules/${kernel.modDirVersion}/build"
  ];

  buildFlags = [ "all" ];

  installPhase = ''
    install -D src/linuwu_sense.ko $out/lib/modules/${kernel.modDirVersion}/extra/linuwu_sense.ko
  '';

  meta = with lib; {
    description = "Linux kernel module for Acer Gaming laptops (Predator/Nitro) - fan control, RGB, thermal profiles";
    homepage = "https://github.com/0x7375646F/Linuwu-Sense";
    license = licenses.gpl3;
    platforms = [ "x86_64-linux" ];
  };
}
