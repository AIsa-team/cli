#!/usr/bin/env bash
# Packages the extension as a .vsix by hand: a vsix is a zip with a manifest
# and a content-types file next to the extension folder. No vsce, no
# node_modules — the extension has zero dependencies.
set -euo pipefail
cd "$(dirname "$0")"
VER=$(node -p "require('./package.json').version")
OUT="aisa-vscode.vsix"
TMP=$(mktemp -d)
mkdir -p "$TMP/extension"
cp package.json extension.js README.md "$TMP/extension/"
cat > "$TMP/[Content_Types].xml" <<'X'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json"/>
  <Default Extension=".js" ContentType="application/javascript"/>
  <Default Extension=".md" ContentType="text/markdown"/>
  <Default Extension=".vsixmanifest" ContentType="text/xml"/>
</Types>
X
cat > "$TMP/extension.vsixmanifest" <<X
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="aisa-vscode" Version="$VER" Publisher="aisa-one"/>
    <DisplayName>AIsa</DisplayName>
    <Description xml:space="preserve">Puts AIsa's models into VS Code chat using the key aisa login stored.</Description>
    <Tags>ai,chat,aisa</Tags>
    <Categories>AI,Chat</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.117.0"/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui,workspace"/>
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets>
</PackageManifest>
X
rm -f "$OUT"
( cd "$TMP" && zip -qr -X "$OLDPWD/$OUT" "[Content_Types].xml" extension.vsixmanifest extension )
rm -rf "$TMP"
ls -l "$OUT"
