#!/usr/bin/env pwsh
# Independent PowerShell/.NET recomputation for the final AC-P6 vectors.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8 = [System.Text.UTF8Encoding]::new($false)
$jsonOptions = [System.Text.Json.JsonSerializerOptions]::new()
$jsonOptions.Encoder = [System.Text.Encodings.Web.JavaScriptEncoder]::UnsafeRelaxedJsonEscaping
if (-not ('RippleCanonical.Utf8ByteComparer' -as [type])) {
  Add-Type @"
using System;
using System.Collections.Generic;
using System.Text;
namespace RippleCanonical {
  public sealed class Utf8ByteComparer : IComparer<string> {
    public int Compare(string a, string b) {
      var x = Encoding.UTF8.GetBytes(a ?? ""); var y = Encoding.UTF8.GetBytes(b ?? "");
      var n = Math.Min(x.Length, y.Length);
      for (var i = 0; i < n; i++) { if (x[i] != y[i]) return x[i].CompareTo(y[i]); }
      return x.Length.CompareTo(y.Length);
    }
  }
}
"@
}
$utf8Comparer = [RippleCanonical.Utf8ByteComparer]::new()
$maxSafeInteger = [double]9007199254740991
$nodeKinds = @('file','symbol','component','route','data','media','token','token-use','jsx-element','state')
$edgeKinds = @('imports','reads','renders','uses-token','token-reference','asset-consumer','css-cascade','same-copy','semantic-link')
$certainties = @('source-proven','runtime-observed','semantic-candidate','unknown')
$sourceUseNodeKinds = @('token-use')
$observationReasonNames = @('complete','missing-side','missing-artifact','artifact-hash-mismatch','artifact-path-invalid','artifact-changed-after-validation','graph-schema-invalid','cross-run','cross-check','side-mismatch','logical-project-mismatch','untrusted-capture','required-verification-not-pass','source-digest-mismatch','graph-digest-mismatch','runtime-version-stale','route-namespace-stale','geometry-only','runtime-location-conflict','declaration-node-not-source-use','relation-not-in-graph','source-use-location-mismatch','duplicate-record','duplicate-artifact-conflict','page-context-mismatch','viewport-mismatch','state-mismatch','identity-not-stable','pseudo-element-without-host-proof','non-strict-consumer-edge','missing-consumer-edge','runtime-instance-without-edge','dynamic-without-runtime-map','page-impact-not-proven','missing-cross-side-map','missing-source-ref','missing-source-use-ref','missing-source-use','source-ref-mismatch','graph-node-not-unique','source-ref-not-in-graph','missing-relation-id','duplicate-relation-id','source-use-ref-mismatch','page-context-unverified','artifact-missing','artifact-digest-mismatch','observation-tuple-mismatch')
function Observation-Code([string]$code) { if ($code.StartsWith('observation/')) { return $code }; return "observation/$code" }
function Ordinal-Equals([string]$a, [string]$b) { return [StringComparer]::Ordinal.Equals($a, $b) }

function Has-Key($map, [string]$key) { return $map -is [System.Collections.IDictionary] -and $map.Contains($key) }
function Assert-Keys($map, [string[]]$allowed, [string]$label) {
  if ($map -isnot [System.Collections.IDictionary]) { throw 'graph-schema-invalid' }
  foreach ($key in $map.Keys) { if ($allowed -notcontains [string]$key) { throw 'graph-schema-invalid' } }
}
function Assert-NonEmptyString($value, [string]$label) {
  if ($value -isnot [string] -or [string]::IsNullOrEmpty($value)) { throw 'graph-schema-invalid' }
}
function Assert-SafeInteger($value, [string]$label) {
  if ($null -eq $value -or $value -is [bool] -or $value -isnot [System.ValueType]) { throw 'graph-schema-invalid' }
  $number = [double]$value
  if ([double]::IsNaN($number) -or [double]::IsInfinity($number) -or [math]::Floor($number) -ne $number -or $number -lt 0 -or $number -gt $maxSafeInteger) { throw 'graph-schema-invalid' }
}
function Assert-StringArray($value, [string]$label) {
  if ($null -eq $value -or $value -is [string]) { throw 'graph-schema-invalid' }
  $seen = [System.Collections.Generic.HashSet[string]]::new()
  foreach ($item in @($value)) {
    Assert-NonEmptyString $item $label
    if (-not $seen.Add([string]$item)) { throw 'graph-schema-invalid' }
  }
}
function Validate-SourceUse($value) {
  Assert-Keys $value @('path','charOffset','byteOffset','offsetUnit') 'sourceUse'
  foreach ($key in @('path','charOffset','byteOffset','offsetUnit')) { if (-not (Has-Key $value $key)) { throw 'graph-schema-invalid' } }
  Assert-NonEmptyString $value.path 'sourceUse.path'
  Assert-SafeInteger $value.charOffset 'sourceUse.charOffset'
  Assert-SafeInteger $value.byteOffset 'sourceUse.byteOffset'
  if ($value.offsetUnit -cne 'code-unit') { throw 'graph-schema-invalid' }
}
function Validate-SourceIdentity($value) {
  Assert-NonEmptyString $value 'sourceIdentity'
  if ([string]$value -cnotmatch '^source:[0-9a-f]{64}:[^:]+:[0-9]+:[0-9]+$') { throw 'graph-schema-invalid' }
}
function Expected-SourceIdentity($graph, $mapping) { return "source:$($graph.sourceDigest):$($mapping.sourceUse.path):$($mapping.sourceUse.charOffset):$($mapping.sourceUse.byteOffset)" }
function Validate-SourceMapping($mapping, $graph, $nodeIds, $edgeIds) {
  Assert-Keys $mapping @('projectId','sourceRef','graphNodeId','sourceAnchorRelationId','sourceIdentity','sourceUse') 'sourceMapping'
  foreach ($key in @('projectId','sourceRef','graphNodeId','sourceAnchorRelationId','sourceIdentity','sourceUse')) { if (-not (Has-Key $mapping $key)) { throw 'graph-schema-invalid' } }
  Assert-NonEmptyString $mapping.projectId 'sourceMapping.projectId'; Assert-NonEmptyString $mapping.sourceRef 'sourceMapping.sourceRef'; Assert-NonEmptyString $mapping.graphNodeId 'sourceMapping.graphNodeId'; Assert-NonEmptyString $mapping.sourceAnchorRelationId 'sourceMapping.sourceAnchorRelationId'; Validate-SourceIdentity $mapping.sourceIdentity; Validate-SourceUse $mapping.sourceUse
  if (-not $nodeIds.Contains([string]$mapping.graphNodeId)) { throw 'graph-schema-invalid' }
  $node = @($graph.nodes | Where-Object { Ordinal-Equals $_.id $mapping.graphNodeId }); if ($node.Count -ne 1 -or -not (Ordinal-Equals $node[0].kind 'token-use')) { throw 'graph-schema-invalid' }
  $anchor = @($graph.edges | Where-Object { Ordinal-Equals $_.id $mapping.sourceAnchorRelationId }); if ($anchor.Count -ne 1) { throw 'graph-schema-invalid' }
  $anchorFrom = @($graph.nodes | Where-Object { Ordinal-Equals $_.id $anchor[0].from }); if ($anchorFrom.Count -ne 1 -or -not (Ordinal-Equals $anchorFrom[0].kind 'file')) { throw 'graph-schema-invalid' }
  if (-not (Ordinal-Equals $anchor[0].kind 'reads') -or -not (Ordinal-Equals $anchor[0].certainty 'source-proven') -or -not (Ordinal-Equals $anchor[0].to $mapping.graphNodeId) -or -not (Source-UseEqual $anchor[0].sourceUse $mapping.sourceUse)) { throw 'graph-schema-invalid' }
  if (-not (Ordinal-Equals $mapping.sourceIdentity (Expected-SourceIdentity $graph $mapping))) { throw 'graph-schema-invalid' }
}
function Validate-Location($value) {
  Assert-Keys $value @('path','start','end','offset','byteOffset') 'location'
  if (-not (Has-Key $value 'path')) { throw 'graph-schema-invalid' }
  Assert-NonEmptyString $value.path 'location.path'
  foreach ($key in @('start','end','offset','byteOffset')) { if (Has-Key $value $key) { Assert-SafeInteger $value[$key] "location.$key" } }
}
function Validate-PageOverrides($value) {
  if ($value -isnot [System.Collections.IDictionary]) { throw 'graph-schema-invalid' }
  foreach ($key in $value.Keys) {
    Assert-NonEmptyString ([string]$key) 'pageOverrides.key'
    Assert-NonEmptyString $value[$key] "pageOverrides.$key"
  }
}
function Validate-Graph($graph) {
  Assert-Keys $graph @('graphIdentityVersion','graphSchemaVersion','relationIdentityVersion','sourceMappingVersion','projectId','sourceMappings','sourceDigest','nodes','edges','unresolved') 'graph'
  foreach ($key in @('graphIdentityVersion','graphSchemaVersion','relationIdentityVersion','sourceMappingVersion','projectId','sourceMappings','sourceDigest','nodes','edges','unresolved')) { if (-not (Has-Key $graph $key)) { throw 'graph-schema-invalid' } }
  if ($graph.graphIdentityVersion -cne 'sourcegraph-identity/v2') { throw 'graph-schema-invalid' }
  Assert-NonEmptyString $graph.graphSchemaVersion 'graphSchemaVersion'
  Assert-NonEmptyString $graph.relationIdentityVersion 'relationIdentityVersion'
  Assert-NonEmptyString $graph.projectId 'graph.projectId'
  if ($graph.sourceMappingVersion -cne 'sourcegraph-source-mapping/v1') { throw 'graph-schema-invalid' }
  if ($graph.sourceDigest -isnot [string] -or $graph.sourceDigest -cnotmatch '^[0-9a-f]{64}$') { throw 'graph-schema-invalid' }
  if ($graph.nodes -isnot [System.Collections.IList] -or $graph.edges -isnot [System.Collections.IList] -or $graph.unresolved -isnot [System.Collections.IList]) { throw 'graph-schema-invalid' }
  Assert-StringArray $graph.unresolved 'graph.unresolved'
  $nodeIds = [System.Collections.Generic.HashSet[string]]::new()
  foreach ($node in @($graph.nodes)) {
    Assert-Keys $node @('id','kind','label','location','page','routePath','pages','selector','selectorScope','byteOffset','mediaContext','className','dynamicClassName','value','pageOverrides','tokenOrigin') 'node'
    foreach ($key in @('id','kind')) { if (-not (Has-Key $node $key)) { throw 'graph-schema-invalid' } }
    Assert-NonEmptyString $node.id 'node.id'; Assert-NonEmptyString $node.kind 'node.kind'
    if ($nodeKinds -cnotcontains $node.kind) { throw 'graph-schema-invalid' }
    if (-not $nodeIds.Add([string]$node.id)) { throw 'graph-schema-invalid' }
    foreach ($key in @('label','page','routePath','selector','selectorScope','className','value','tokenOrigin')) { if (Has-Key $node $key) { Assert-NonEmptyString $node[$key] "node.$key" } }
    foreach ($key in @('pages','mediaContext')) { if (Has-Key $node $key) { Assert-StringArray $node[$key] "node.$key" } }
    if (Has-Key $node 'byteOffset') { Assert-SafeInteger $node.byteOffset 'node.byteOffset' }
    if (Has-Key $node 'dynamicClassName' -and $node.dynamicClassName -isnot [bool]) { throw 'graph-schema-invalid' }
    if (Has-Key $node 'location') { Validate-Location $node.location }
    if (Has-Key $node 'pageOverrides') { Validate-PageOverrides $node.pageOverrides }
  }
  $edgeIds = [System.Collections.Generic.HashSet[string]]::new()
  foreach ($edge in @($graph.edges)) {
    Assert-Keys $edge @('id','from','to','kind','certainty','evidenceRefs','sourceUse','selectorScope','mediaContext','producerIdentity','sourceIdentity') 'edge'
    foreach ($key in @('id','from','to','kind','certainty','evidenceRefs')) { if (-not (Has-Key $edge $key)) { throw 'graph-schema-invalid' } }
    Assert-NonEmptyString $edge.id 'edge.id'; Assert-NonEmptyString $edge.from 'edge.from'; Assert-NonEmptyString $edge.to 'edge.to'
    if (-not $edgeIds.Add([string]$edge.id)) { throw 'graph-schema-invalid' }
    if (-not $nodeIds.Contains([string]$edge.from) -or -not $nodeIds.Contains([string]$edge.to)) { throw 'graph-schema-invalid' }
    if ($edgeKinds -cnotcontains $edge.kind -or $certainties -cnotcontains $edge.certainty) { throw 'graph-schema-invalid' }
    Assert-StringArray $edge.evidenceRefs 'edge.evidenceRefs'
    if (Has-Key $edge 'sourceUse') { Validate-SourceUse $edge.sourceUse }
    foreach ($key in @('selectorScope','producerIdentity','sourceIdentity')) { if (Has-Key $edge $key) { Assert-NonEmptyString $edge[$key] "edge.$key" } }
    if (Has-Key $edge 'mediaContext') { Assert-StringArray $edge.mediaContext 'edge.mediaContext' }
  }
  $mappingRefs = [System.Collections.Generic.HashSet[string]]::new(); $mappingNodes = [System.Collections.Generic.HashSet[string]]::new(); $mappingAnchors = [System.Collections.Generic.HashSet[string]]::new()
  foreach ($mapping in @($graph.sourceMappings)) {
    Validate-SourceMapping $mapping $graph $nodeIds $edgeIds
    if (-not (Ordinal-Equals $mapping.sourceRef $mapping.graphNodeId)) { throw 'graph-schema-invalid' }
    if (-not $mappingRefs.Add([string]$mapping.sourceRef) -or -not $mappingNodes.Add([string]$mapping.graphNodeId) -or -not $mappingAnchors.Add([string]$mapping.sourceAnchorRelationId)) { throw 'graph-schema-invalid' }
  }
}

function Convert-Canonical([object] $value) {
  if ($null -eq $value) { throw 'explicit null is not allowed' }
  if ($value -is [System.Collections.IDictionary]) {
    $parts = [System.Collections.Generic.List[string]]::new()
    [string[]]$keys = @($value.Keys | ForEach-Object { [string]$_ })
    [Array]::Sort($keys, $utf8Comparer)
    foreach ($key in $keys) {
      $parts.Add(([System.Text.Json.JsonSerializer]::Serialize([string]$key, $jsonOptions) + ':' + (Convert-Canonical $value[$key])))
    }
    return '{' + [string]::Join(',', $parts) + '}'
  }
  if ($value -is [System.Collections.IList] -and $value -isnot [string]) {
    $parts = @($value | ForEach-Object { Convert-Canonical $_ })
    return '[' + [string]::Join(',', $parts) + ']'
  }
  if ($value -is [double] -or $value -is [decimal]) {
    if ([double]::IsNaN([double]$value) -or [double]::IsInfinity([double]$value) -or ([double]$value -eq 0 -and [double]::IsNegative([double]$value))) { throw 'non-canonical number' }
  }
  return [System.Text.Json.JsonSerializer]::Serialize($value, $jsonOptions)
}

function Read-Json($name) {
  Get-Content (Join-Path $root "vectors/$name") -Raw | ConvertFrom-Json -AsHashtable
}

function Sort-StringArray($items) {
  $values = [string[]]@($items)
  [Array]::Sort($values, $utf8Comparer)
  return ,$values
}

function Sort-ById($items) {
  $values = [object[]]@($items)
  $comparison = [System.Comparison[object]]{ param($a, $b) $utf8Comparer.Compare([string]$a['id'], [string]$b['id']) }
  [Array]::Sort($values, $comparison)
  return ,$values
}
function Sort-BySourceRef($items) {
  $values = [object[]]@($items)
  $comparison = [System.Comparison[object]]{ param($a, $b) $utf8Comparer.Compare([string]$a['sourceRef'], [string]$b['sourceRef']) }
  [Array]::Sort($values, $comparison)
  return ,$values
}

function Normalize-Graph($g) {
  $nodes = @($g.nodes | ForEach-Object {
    $n = [ordered]@{}
    foreach ($k in $_.Keys) { $n[$k] = $_[$k] }
    foreach ($k in @('pages','mediaContext')) { if ($n.Contains($k)) { $n[$k] = Sort-StringArray $n[$k] } }
    $n
  })
  $nodes = Sort-ById $nodes
  $edges = @($g.edges | ForEach-Object {
    $e = [ordered]@{}
    foreach ($k in $_.Keys) { $e[$k] = $_[$k] }
    foreach ($k in @('evidenceRefs','mediaContext')) { if ($e.Contains($k)) { $e[$k] = Sort-StringArray $e[$k] } }
    $e
  })
  $edges = Sort-ById $edges
  [ordered]@{
    graphIdentityVersion = $g.graphIdentityVersion
    graphSchemaVersion = $g.graphSchemaVersion
    relationIdentityVersion = $g.relationIdentityVersion
    sourceMappingVersion = $g.sourceMappingVersion
    projectId = $g.projectId
    sourceMappings = Sort-BySourceRef $g.sourceMappings
    sourceDigest = $g.sourceDigest
    nodes = $nodes
    edges = $edges
    unresolved = Sort-StringArray $g.unresolved
  }
}

function Digest($domain, $canonicalJson) {
  $bytes = $utf8.GetBytes($domain + $canonicalJson)
  $hash = [System.Security.Cryptography.SHA256]::HashData($bytes)
  -join ($hash | ForEach-Object { $_.ToString('x2') })
}

function CanonicalBytesSha($canonicalJson) {
  $hash = [System.Security.Cryptography.SHA256]::HashData($utf8.GetBytes($canonicalJson))
  -join ($hash | ForEach-Object { $_.ToString('x2') })
}

function CanonicalBytesBase64($canonicalJson) { [Convert]::ToBase64String($utf8.GetBytes($canonicalJson)) }

function Source-UseEqual($a, $b) {
  return (Ordinal-Equals $a.path $b.path) -and $a.charOffset -eq $b.charOffset -and $a.byteOffset -eq $b.byteOffset -and (Ordinal-Equals $a.offsetUnit $b.offsetUnit)
}
$fixture = Join-Path $root 'g0.json'
$fixtureBytes = [System.IO.File]::ReadAllBytes($fixture)
$inputSha = -join ([System.Security.Cryptography.SHA256]::HashData($fixtureBytes) | ForEach-Object { $_.ToString('x2') })
$graph = Get-Content $fixture -Raw | ConvertFrom-Json -AsHashtable
try {
  Validate-Graph $graph
  $canonical = Convert-Canonical (Normalize-Graph $graph)
  $canonicalBytes = $utf8.GetBytes($canonical)
  $domain = 'ripple/sourcegraph-identity/v2/graphDigest' + [char]0
  $digest = Digest $domain $canonical
  $output = [ordered]@{
    status = 'passed'
    exitCode = 0
    input = [ordered]@{ path = 'g0.json'; bytes = $fixtureBytes.Length; sha256 = $inputSha }
    output = [ordered]@{ canonicalJson = $canonical; canonicalBytesBase64 = [Convert]::ToBase64String($canonicalBytes); canonicalBytes = $canonicalBytes.Length; canonicalBytesSha256 = (CanonicalBytesSha $canonical) }
    domain = $domain
    domainBytesUtf8Hex = (-join ($utf8.GetBytes($domain) | ForEach-Object { $_.ToString('x2') }))
    graphDigest = $digest
    serializerSha256 = (Get-FileHash (Join-Path $root 'canonical-observation-digest.ps1') -Algorithm SHA256).Hash.ToLower()
  }
  $output | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 (Join-Path $root 'powershell-output.json')
  $output | ConvertTo-Json -Depth 20
  exit 0
} catch {
  $output = [ordered]@{ status = 'failed'; exitCode = 1; input = [ordered]@{ path = 'g0.json'; bytes = $fixtureBytes.Length; sha256 = $inputSha }; error = $_.Exception.Message }
  $output | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 (Join-Path $root 'powershell-output.json')
  $output | ConvertTo-Json -Depth 20
  exit 1
}
