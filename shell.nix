# Utviklingsmiljø for NixOS.
#
# Prisma 7 har fortsatt en native schema-engine for migreringer, og Prisma
# publiserer ikke ferdigbygde motorer for NixOS. `prisma-engines_7` fra
# nixpkgs unstable setter PRISMA_SCHEMA_ENGINE_BINARY via sin setup-hook, slik
# at den lokale Prisma-CLI-en slipper å laste ned en motor for linux-nixos.
#
#   nix-shell
#   npm install
#   npm run db:migrate
#
# Node 22 holdes fra nixpkgs 24.11 for å matche Docker-imaget og CI.
{
  pkgs ? import (fetchTarball "https://github.com/NixOS/nixpkgs/archive/refs/tags/24.11.tar.gz") { },
  # Pinned nixos-unstable-revisjon med prisma-engines_7 7.10.0.
  unstable ? import (fetchTarball "https://github.com/NixOS/nixpkgs/archive/02c087f3fe673c9e317f206a627cb6b910336dbe.tar.gz") { },
}:

pkgs.mkShell {
  buildInputs = with pkgs; [
    nodejs_22
    openssl
    unstable.prisma-engines_7
  ];

  # Settes også av setup-hooken til prisma-engines_7, men vi gjør det eksplisitt
  # slik at en fremtidig endring i nixpkgs ikke gjør shellen stille ubrukelig.
  shellHook = ''
    export PRISMA_SCHEMA_ENGINE_BINARY="${unstable.prisma-engines_7}/bin/schema-engine"
  '';
}
