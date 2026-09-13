{
  description = "Patched Acer Predator/Nitro hardware tooling for NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in {
      packages = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in rec {
          default = rusense;
          rusense = pkgs.callPackage ./nix/rusense.nix {};
          linuwu-sense = pkgs.linuxPackages_latest.callPackage ./nix/linuwu-sense.nix {};
        }
      );

      overlays.default = final: prev: {
        rusense = final.callPackage ./nix/rusense.nix {};
      };

      nixosModules = rec {
        default = psense;
        psense = import ./nix/module.nix self;
      };
    };
}
