{
  description = "A basic flake with a shell for nodejs backend";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    foundry.url = "github:shazow/foundry.nix/stable"; # Use stable branch for permanent releases
    solc = {
      url = "github:hellwolf/solc.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      foundry,
      solc,
      ...
    }@inputs:
    let
      inherit (nixpkgs) lib;
      forEachSystem =
        f:
        inputs.nixpkgs.lib.genAttrs nixpkgs.lib.systems.flakeExposed (
          system:
          f {
            pkgs = import inputs.nixpkgs {
              inherit system;
              overlays = [
                foundry.overlay
                solc.overlay
                inputs.self.overlays.default
              ];
            };
          }
        );
    in
    {
      overlays.default = final: prev: rec {
        nodejs = prev.nodejs;
        yarn = (prev.yarn.override { inherit nodejs; });
      };

      devShells = forEachSystem (
        { pkgs }:
        {
          default = pkgs.mkShell {
            buildInputs = with pkgs; [
              node2nix
              nodejs
              nodePackages.pnpm
              typescript
              yarn
              git

              foundry-bin

              # ... any other dependencies we need
              solc_0_8_25
              (solc.mkDefault pkgs solc_0_8_25)
            ];
          };
        }
      );

      packages = forEachSystem (
        { pkgs }:
        rec {
          redis = pkgs.dockerTools.buildImage {
            name = "redis";
            tag = "latest";

            fromImageName = null;
            fromImageTag = "latest";

            copyToRoot = pkgs.buildEnv {
              name = "image-root";
              paths = [ pkgs.redis ];
              pathsToLink = [ "/bin" ];
            };

            runAsRoot = ''
              #!${pkgs.runtimeShell}
              mkdir -p /data
            '';

            config = {
              Cmd = [ "/bin/redis-server" ];
              WorkingDir = "/data";
              Volumes = {
                "/data" = { };
              };
            };

            diskSize = 1024;
            buildVMMemorySize = 512;
          };
        }
      );
    };
}
