# Utviklingsmiljø for NixOS.
#
# Prisma 5.22 har ikke ferdigbygde motorer for NixOS, så `prisma generate` feiler
# med 404 mot binaries.prisma.sh. nixpkgs 24.11 har `prisma-engines` i versjon
# 5.22.0, som matcher `prisma` og `@prisma/client` i package.json. Shellen peker
# Prisma mot disse motorene i stedet for å laste dem ned.
#
#   nix-shell
#   rm -rf node_modules
#   npm install
#
# Shellen bruker Node 22 fra nixpkgs 24.11, som er versjonen Docker-imaget og
# CI bruker. Systemets egen Node kan brukes utenfor shellen.
{
  pkgs ? import (fetchTarball "https://github.com/NixOS/nixpkgs/archive/refs/tags/24.11.tar.gz") { },
}:

pkgs.mkShell {
  buildInputs = with pkgs; [
    nodejs_22
    prisma-engines
    openssl
  ];

  shellHook = ''
    export PRISMA_SCHEMA_ENGINE_BINARY="${pkgs.prisma-engines}/bin/schema-engine"
    export PRISMA_QUERY_ENGINE_BINARY="${pkgs.prisma-engines}/bin/query-engine"
    export PRISMA_QUERY_ENGINE_LIBRARY="${pkgs.prisma-engines}/lib/libquery_engine.node"
    export PRISMA_FMT_BINARY="${pkgs.prisma-engines}/bin/prisma-fmt"

    echo "Prisma 5.22-motorer fra nixpkgs 24.11 er satt opp."
    echo "Kjør «rm -rf node_modules && npm install» hvis du kommer fra en feilet installasjon."
  '';
}
