{ lib
, rustPlatform
, pkg-config
, wrapGAppsHook3
, makeDesktopItem
, copyDesktopItems
, dbus
, glib
, gtk3
, webkitgtk_4_1
, libsoup_3
}:

rustPlatform.buildRustPackage {
  pname = "rusense";
  version = "0.1.1";

  src = ../rusense;

  cargoLock = {
    lockFile = ../rusense/Cargo.lock;
  };

  nativeBuildInputs = [
    pkg-config
    wrapGAppsHook3
    copyDesktopItems
  ];

  buildInputs = [
    dbus
    glib
    gtk3
    webkitgtk_4_1
    libsoup_3
  ];

  desktopItems = [
    (makeDesktopItem {
      name = "rusense";
      desktopName = "RuSense";
      comment = "Acer Nitro/Predator Hardware Manager";
      exec = "rusense-gui";
      icon = "rusense";
      categories = [ "System" "Utility" ];
    })
  ];

  postInstall = ''
    install -D gui/icons/icon.png $out/share/icons/hicolor/128x128/apps/rusense.png
  '';

  meta = with lib; {
    description = "NitroSense/AcerSense for Linux in Rust (TUI + GUI) over Linuwu-Sense driver";
    homepage = "https://github.com/r3nv-dev/rusense";
    license = licenses.gpl3Only;
    platforms = [ "x86_64-linux" ];
    mainProgram = "rusense";
  };
}
