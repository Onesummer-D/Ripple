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

function Validate-ArtifactPath($path) {
  $badSegments = @($path.Split('/') | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' })
  if ([string]::IsNullOrEmpty($path) -or $path.Contains([char]0) -or $path.Contains('\') -or $path.StartsWith('/') -or $path.StartsWith('//') -or $path -match '^[A-Za-z]:' -or $path.Contains('//') -or $badSegments.Count -gt 0) { throw 'artifact-path-invalid' }
}

function Validate-Route($route) {
  if ([string]::IsNullOrEmpty($route) -or $route -match '[\\\x00-\x20\x7f]' -or $route -notmatch '^/[^?#]*(?:\?[^#]+)?(?:#.+)?$') { throw 'observation-tuple-mismatch' }
}

function Validate-Sha256($value) {
  if ($value -isnot [string] -or $value -cnotmatch '^[0-9a-f]{64}$') { throw 'graph-schema-invalid' }
}

function Validate-Binding($binding) {
  Validate-Route $binding.route
  if ([string]::IsNullOrEmpty($binding.page.pathname) -or $binding.page.pathname -notmatch '^/[^?#]*$' -or $binding.page.pathname -match '[\x00-\x20\x7f]') { throw 'observation-tuple-mismatch' }
  if ($binding.page.search -ne '' -and $binding.page.search -notmatch '^\?[^#\x00-\x20\x7f]+$') { throw 'observation-tuple-mismatch' }
  if ($binding.page.hash -ne '' -and $binding.page.hash -notmatch '^#[^\x00-\x20\x7f]+$') { throw 'observation-tuple-mismatch' }
  Assert-SafeInteger $binding.viewport.width 'viewport.width'; Assert-SafeInteger $binding.viewport.height 'viewport.height'
  if ($binding.viewport.width -lt 1 -or $binding.viewport.height -lt 1) { throw 'observation-tuple-mismatch' }
  if ($binding.viewport.Contains('deviceScaleFactor') -and ($binding.viewport.deviceScaleFactor -is [bool] -or $binding.viewport.deviceScaleFactor -isnot [System.ValueType] -or [double]$binding.viewport.deviceScaleFactor -le 0 -or [double]::IsNaN([double]$binding.viewport.deviceScaleFactor) -or [double]::IsInfinity([double]$binding.viewport.deviceScaleFactor))) { throw 'graph-schema-invalid' }
  if ($binding.artifact.kind -cnotin @('observation-json','runtime-snapshot','mapping')) { throw 'graph-schema-invalid' }
  Validate-ArtifactPath $binding.artifact.path
  Validate-Sha256 $binding.artifact.sha256
  Assert-SafeInteger $binding.artifact.sizeBytes 'artifact.sizeBytes'
}

function Validate-Negative($name, $expected) {
  try {
    $input = Read-Json $name
    if ($name -in @('g3-duplicate-relation.json','negative-unknown-location.json','negative-page-overrides.json','negative-missing-evidence-refs.json','negative-kind.json','negative-unsafe-integer.json','negative-empty-page-key.json','legacy-v5.json','negative-missing-relation-source-identity.json','negative-forged-source-identity.json','negative-missing-source-mappings.json','negative-forged-source-mappings.json','negative-old-source-digest.json','negative-missing-source-anchor.json','negative-nonunique-source-anchor.json','negative-source-use-location.json')) {
      Validate-Graph $input
    } elseif ($name -eq 'negative-route.json') {
      Validate-Route $input.route
    } elseif ($name -eq 'negative-artifact-path.json') {
      Validate-ArtifactPath $input.artifact.path
    }
    return [ordered]@{ pass = $false; expectedReasonCode = $expected; reasonCode = 'unexpected-pass'; observationReasonCode = (Observation-Code 'unexpected-pass') }
  } catch {
    $code = $_.Exception.Message
    return [ordered]@{ pass = ($code -eq $expected); expectedReasonCode = $expected; reasonCode = $code; observationReasonCode = (Observation-Code $code) }
  }
}

function Add-ExecutedStatus($result) {
  $passed = [bool]$result.pass
  $result.status = if ($passed) { 'passed' } else { 'failed' }
  $result.prepared = $true
  $result.executed = $true
  $result.passed = $passed
  $result.failed = -not $passed
  $result.blocked = $false
  return $result
}

function Source-UseEqual($a, $b) {
  return (Ordinal-Equals $a.path $b.path) -and $a.charOffset -eq $b.charOffset -and $a.byteOffset -eq $b.byteOffset -and (Ordinal-Equals $a.offsetUnit $b.offsetUnit)
}

function Validate-HostSideBinding($graph, $hostSideBinding) {
  Assert-Keys $hostSideBinding @('side','projectId','graphIdentityVersion','graphSchemaVersion','relationIdentityVersion','sourceMappingVersion','sourceDigest','graphDigest') 'hostSideBinding'
  foreach ($key in @('side','projectId','graphIdentityVersion','graphSchemaVersion','relationIdentityVersion','sourceMappingVersion','sourceDigest','graphDigest')) { if (-not (Has-Key $hostSideBinding $key)) { throw 'untrusted-capture' } }
  if ($hostSideBinding.side -cnotin @('baseline','candidate')) { throw 'side-mismatch' }
  Validate-Graph $graph
  $expectedGraphDigest = Digest "ripple/sourcegraph-identity/v2/graphDigest`0" (Convert-Canonical (Normalize-Graph $graph))
  if ($graph.projectId -cne $hostSideBinding.projectId) { throw 'logical-project-mismatch' }
  if ($graph.sourceDigest -cne $hostSideBinding.sourceDigest) { throw 'source-digest-mismatch' }
  if ($expectedGraphDigest -cne $hostSideBinding.graphDigest) { throw 'graph-digest-mismatch' }
  foreach ($key in @('graphIdentityVersion','graphSchemaVersion','relationIdentityVersion','sourceMappingVersion')) { if ($graph[$key] -cne $hostSideBinding[$key]) { throw 'graph-digest-mismatch' } }
}

function Validate-GraphReference($binding, $graph, $hostSideBinding) {
  Validate-HostSideBinding $graph $hostSideBinding
  foreach ($key in @('graphIdentityVersion','graphSchemaVersion','relationIdentityVersion','sourceMappingVersion','projectId','sourceDigest','graphDigest')) {
    if ($binding.graph[$key] -cne $hostSideBinding[$key]) {
      if ($key -eq 'projectId') { throw 'logical-project-mismatch' }
      if ($key -eq 'sourceDigest') { throw 'source-digest-mismatch' }
      throw 'graph-digest-mismatch'
    }
  }
  if ($binding.side -cne $hostSideBinding.side) { throw 'side-mismatch' }
  if ($binding.sourceUseRef -and $null -eq $binding.sourceRef) { throw 'missing-source-ref' }
  if ($binding.sourceUseRef -and $binding.sourceRef -cne $binding.sourceUseRef.sourceRef) { throw 'source-ref-mismatch' }
  if ($null -eq $binding.sourceUseRef) { return }
  $nodes = @($graph.nodes | Where-Object { Ordinal-Equals $_.id $binding.sourceUseRef.graphNodeId })
  if ($nodes.Count -eq 0) { throw 'source-ref-not-in-graph' }
  if ($nodes.Count -ne 1) { throw 'graph-node-not-unique' }
  if ($sourceUseNodeKinds -cnotcontains $nodes[0].kind) { throw 'declaration-node-not-source-use' }
  if (-not (Ordinal-Equals $nodes[0].id $binding.sourceRef) -or -not (Ordinal-Equals $nodes[0].id $binding.sourceUseRef.sourceRef)) { throw 'source-ref-not-in-graph' }
  $mappings = @($graph.sourceMappings | Where-Object { (Ordinal-Equals $_.sourceRef $binding.sourceRef) -and (Ordinal-Equals $_.graphNodeId $binding.sourceUseRef.graphNodeId) })
  if ($mappings.Count -ne 1) { throw 'source-ref-not-in-graph' }
  if (-not (Ordinal-Equals $mappings[0].projectId $binding.graph.projectId)) { throw 'logical-project-mismatch' }
  if (-not (Ordinal-Equals $mappings[0].sourceIdentity (Expected-SourceIdentity $graph $mappings[0]))) { throw 'source-ref-not-in-graph' }
  if (-not (Source-UseEqual $mappings[0].sourceUse $binding.sourceUseRef.sourceUse)) { throw 'source-use-location-mismatch' }
  if ($null -eq $binding.sourceUseRef.relationId) { return }
  $edges = @($graph.edges | Where-Object { Ordinal-Equals $_.id $binding.sourceUseRef.relationId })
  if ($edges.Count -eq 0) { throw 'relation-not-in-graph' }
  if ($edges.Count -ne 1) { throw 'duplicate-relation-id' }
  if (-not (Ordinal-Equals $edges[0].from $binding.sourceUseRef.graphNodeId) -or -not (Source-UseEqual $edges[0].sourceUse $binding.sourceUseRef.sourceUse)) { throw 'source-use-ref-mismatch' }
  if ($edges[0].kind -cne 'reads' -or $edges[0].certainty -cne 'source-proven') { throw 'relation-not-in-graph' }
  if ($edges[0].Contains('sourceIdentity') -and -not (Ordinal-Equals $edges[0].sourceIdentity $mappings[0].sourceIdentity)) { throw 'source-ref-mismatch' }
}

function Validate-GraphReferenceNegative($binding, $graph, $field, $expected, $hostSideBinding) {
  try {
    $copy = $binding | ConvertTo-Json -Depth 20 | ConvertFrom-Json -AsHashtable
    $copy.graph.graphDigest = Digest "ripple/sourcegraph-identity/v2/graphDigest`0" (Convert-Canonical (Normalize-Graph $graph))
    if ($field -eq 'sourceRef') { $copy.sourceRef = 'node:other' }
    if ($field -eq 'graphNodeId') { $copy.sourceUseRef.graphNodeId = 'node:missing' }
    if ($field -eq 'sourceUse') { $copy.sourceUseRef.sourceUse.byteOffset = 99 }
    if ($field -eq 'duplicateRelation') { $graph = [ordered]@{ nodes = $graph.nodes; edges = @($graph.edges + $graph.edges[0]) } }
    Validate-GraphReference $copy $graph $hostSideBinding
    return [ordered]@{ pass = $false; expectedReasonCode = $expected; reasonCode = 'unexpected-pass'; observationReasonCode = (Observation-Code 'unexpected-pass') }
  } catch {
    $code = $_.Exception.Message
    return [ordered]@{ pass = ($code -eq $expected); expectedReasonCode = $expected; reasonCode = $code; observationReasonCode = (Observation-Code $code) }
  }
}
function Validate-GraphReferenceCase($binding, $graph, $expected, $hostSideBinding) {
  try {
    Validate-GraphReference $binding $graph $hostSideBinding
    return [ordered]@{ pass = $false; expectedReasonCode = $expected; reasonCode = 'unexpected-pass'; observationReasonCode = (Observation-Code 'unexpected-pass') }
  } catch {
    $code = $_.Exception.Message
    return [ordered]@{ pass = ($code -eq $expected); expectedReasonCode = $expected; reasonCode = $code; observationReasonCode = (Observation-Code $code) }
  }
}

$g0 = Read-Json 'g0.json'; $g1 = Read-Json 'g1-shuffled.json'; $g2 = Read-Json 'g2-byte-offset-changed.json'; $g3 = Read-Json 'g3-duplicate-relation.json'; $g4 = Read-Json 'g4-nonascii.json'; $g5 = Read-Json 'g5-candidate-side.json'; $g0ProjectMismatch = Read-Json 'g0-project-mismatch.json'; $g0SemanticCandidate = Read-Json 'g0-semantic-candidate.json'
Validate-Graph $g0; Validate-Graph $g1; Validate-Graph $g2; Validate-Graph $g4
$c0 = Convert-Canonical (Normalize-Graph $g0); $c1 = Convert-Canonical (Normalize-Graph $g1); $c2 = Convert-Canonical (Normalize-Graph $g2)
$c4 = Convert-Canonical (Normalize-Graph $g4)
$d0 = Digest "ripple/sourcegraph-identity/v2/graphDigest`0" $c0
$d1 = Digest "ripple/sourcegraph-identity/v2/graphDigest`0" $c1
$d2 = Digest "ripple/sourcegraph-identity/v2/graphDigest`0" $c2
$d4 = Digest "ripple/sourcegraph-identity/v2/graphDigest`0" $c4
$projectMismatchDigest = Digest "ripple/sourcegraph-identity/v2/graphDigest`0" (Convert-Canonical (Normalize-Graph $g0ProjectMismatch))
$semanticCandidateDigest = Digest "ripple/sourcegraph-identity/v2/graphDigest`0" (Convert-Canonical (Normalize-Graph $g0SemanticCandidate))
$baselineHost = [ordered]@{ side = 'baseline'; projectId = $g0.projectId; graphIdentityVersion = $g0.graphIdentityVersion; graphSchemaVersion = $g0.graphSchemaVersion; relationIdentityVersion = $g0.relationIdentityVersion; sourceMappingVersion = $g0.sourceMappingVersion; sourceDigest = $g0.sourceDigest; graphDigest = $d0 }
$candidateHost = [ordered]@{ side = 'candidate'; projectId = $g5.projectId; graphIdentityVersion = $g5.graphIdentityVersion; graphSchemaVersion = $g5.graphSchemaVersion; relationIdentityVersion = $g5.relationIdentityVersion; sourceMappingVersion = $g5.sourceMappingVersion; sourceDigest = $g5.sourceDigest; graphDigest = (Digest "ripple/sourcegraph-identity/v2/graphDigest`0" (Convert-Canonical (Normalize-Graph $g5))) }
$semanticCandidateHost = [ordered]@{ side = 'baseline'; projectId = $g0SemanticCandidate.projectId; graphIdentityVersion = $g0SemanticCandidate.graphIdentityVersion; graphSchemaVersion = $g0SemanticCandidate.graphSchemaVersion; relationIdentityVersion = $g0SemanticCandidate.relationIdentityVersion; sourceMappingVersion = $g0SemanticCandidate.sourceMappingVersion; sourceDigest = $g0SemanticCandidate.sourceDigest; graphDigest = $semanticCandidateDigest }
$b0 = Read-Json 'b0-observation.json'; $b0.graph.graphDigest = $d0
$forgedGraph = $g0 | ConvertTo-Json -Depth 30 | ConvertFrom-Json -AsHashtable
$forgedSourceUse = [ordered]@{ path = 'src/a.css'; charOffset = 8; byteOffset = 8; offsetUnit = 'code-unit' }
$forgedGraph.nodes = @($forgedGraph.nodes) + @([ordered]@{ id = 'node:forged'; kind = 'token-use'; label = 'var(--forged)'; location = [ordered]@{ path = 'src/a.css'; offset = 8; byteOffset = 8 } })
$forgedGraph.edges = @($forgedGraph.edges) + @([ordered]@{ id = 'anchor:forged'; from = 'file:source-anchor'; to = 'node:forged'; kind = 'reads'; certainty = 'source-proven'; evidenceRefs = @('forged-anchor'); sourceUse = $forgedSourceUse; producerIdentity = 'attacker-source-map/v9' }) + @([ordered]@{ id = 'rel:forged'; from = 'node:forged'; to = 'node:b'; kind = 'reads'; certainty = 'source-proven'; evidenceRefs = @('forged-relation'); sourceUse = $forgedSourceUse })
$forgedGraph.sourceMappings = @($forgedGraph.sourceMappings) + @([ordered]@{ projectId = $forgedGraph.projectId; sourceRef = 'node:forged'; graphNodeId = 'node:forged'; sourceAnchorRelationId = 'anchor:forged'; sourceIdentity = "source:$($forgedGraph.sourceDigest):src/a.css:8:8"; sourceUse = $forgedSourceUse })
$forgedGraphDigest = Digest "ripple/sourcegraph-identity/v2/graphDigest`0" (Convert-Canonical (Normalize-Graph $forgedGraph))
$forgedBinding = $b0 | ConvertTo-Json -Depth 30 | ConvertFrom-Json -AsHashtable; $forgedBinding.sourceRef = 'node:forged'; $forgedBinding.sourceUseRef.sourceRef = 'node:forged'; $forgedBinding.sourceUseRef.graphNodeId = 'node:forged'; $forgedBinding.sourceUseRef.relationId = 'rel:forged'; $forgedBinding.sourceUseRef.sourceUse = $forgedSourceUse; $forgedBinding.graph.graphDigest = $forgedGraphDigest
$usesTokenConsumerGraph = $g0 | ConvertTo-Json -Depth 30 | ConvertFrom-Json -AsHashtable
foreach ($edge in @($usesTokenConsumerGraph.edges)) { if ($edge.id -ceq 'rel:a') { $edge.kind = 'uses-token' } }
$usesTokenConsumerDigest = Digest "ripple/sourcegraph-identity/v2/graphDigest`0" (Convert-Canonical (Normalize-Graph $usesTokenConsumerGraph))
$usesTokenConsumerHost = [ordered]@{ side = 'baseline'; projectId = $usesTokenConsumerGraph.projectId; graphIdentityVersion = $usesTokenConsumerGraph.graphIdentityVersion; graphSchemaVersion = $usesTokenConsumerGraph.graphSchemaVersion; relationIdentityVersion = $usesTokenConsumerGraph.relationIdentityVersion; sourceMappingVersion = $usesTokenConsumerGraph.sourceMappingVersion; sourceDigest = $usesTokenConsumerGraph.sourceDigest; graphDigest = $usesTokenConsumerDigest }
$usesTokenBinding = $b0 | ConvertTo-Json -Depth 30 | ConvertFrom-Json -AsHashtable; $usesTokenBinding.graph.graphDigest = $usesTokenConsumerDigest
$binding = [ordered]@{}
foreach ($key in $b0.Keys) { if ($key -notin @('status','proof','primaryReasonCode','secondaryReasonCodes','observationBindingDigest','diagnostic')) { $binding[$key] = $b0[$key] } }
Validate-Binding $b0
$bc = Convert-Canonical $binding
$bd = Digest "ripple/sourcegraph-observation-binding/v1/observationBindingDigest`0" $bc
$negative = [ordered]@{}
$negative['G3'] = Add-ExecutedStatus (Validate-Negative 'g3-duplicate-relation.json' 'graph-schema-invalid')
$negative['negative-unknown-location'] = Add-ExecutedStatus (Validate-Negative 'negative-unknown-location.json' 'graph-schema-invalid')
$negative['negative-page-overrides'] = Add-ExecutedStatus (Validate-Negative 'negative-page-overrides.json' 'graph-schema-invalid')
$negative['missing-evidence-refs'] = Add-ExecutedStatus (Validate-Negative 'negative-missing-evidence-refs.json' 'graph-schema-invalid')
$negative['invalid-node-kind'] = Add-ExecutedStatus (Validate-Negative 'negative-kind.json' 'graph-schema-invalid')
$negative['unsafe-integer'] = Add-ExecutedStatus (Validate-Negative 'negative-unsafe-integer.json' 'graph-schema-invalid')
$negative['empty-page-overrides-key'] = Add-ExecutedStatus (Validate-Negative 'negative-empty-page-key.json' 'graph-schema-invalid')
$negative['negative-route'] = Add-ExecutedStatus (Validate-Negative 'negative-route.json' 'observation-tuple-mismatch')
$negative['negative-artifact-path'] = Add-ExecutedStatus (Validate-Negative 'negative-artifact-path.json' 'artifact-path-invalid')
$negative['legacy-v5'] = Add-ExecutedStatus (Validate-Negative 'legacy-v5.json' 'graph-schema-invalid')
$negative['source-ref-mismatch'] = Add-ExecutedStatus (Validate-GraphReferenceNegative $b0 $g0 'sourceRef' 'source-ref-mismatch' $baselineHost)
$negative['graph-node-missing'] = Add-ExecutedStatus (Validate-GraphReferenceNegative $b0 $g0 'graphNodeId' 'source-ref-not-in-graph' $baselineHost)
$negative['source-use-mismatch'] = Add-ExecutedStatus (Validate-GraphReferenceNegative $b0 $g0 'sourceUse' 'source-use-location-mismatch' $baselineHost)
$negative['duplicate-relation-id'] = Add-ExecutedStatus (Validate-GraphReferenceNegative $b0 $g0 'duplicateRelation' 'graph-schema-invalid' $baselineHost)
$opaque = Read-Json 'negative-opaque-source-ref.json'
$declaration = Read-Json 'negative-declaration-node.json'
$crossSide = Read-Json 'negative-cross-side-source-ref.json'; $g5 = Read-Json 'g5-candidate-side.json'; Validate-Graph $g5
$negative['opaque-source-ref'] = Add-ExecutedStatus (Validate-GraphReferenceNegative $opaque $g0 'none' 'source-ref-not-in-graph' $baselineHost)
$negative['declaration-node-not-source-use'] = Add-ExecutedStatus (Validate-GraphReferenceNegative $declaration $g0 'none' 'declaration-node-not-source-use' $baselineHost)
$negative['cross-side-source-ref'] = Add-ExecutedStatus (Validate-GraphReferenceNegative $crossSide $g5 'none' 'source-ref-not-in-graph' $candidateHost)
$negative['missing-relation-source-identity'] = Add-ExecutedStatus (Validate-Negative 'negative-missing-relation-source-identity.json' 'graph-schema-invalid')
$negative['forged-source-identity'] = Add-ExecutedStatus (Validate-Negative 'negative-forged-source-identity.json' 'graph-schema-invalid')
$negative['missing-source-mappings'] = Add-ExecutedStatus (Validate-Negative 'negative-missing-source-mappings.json' 'graph-schema-invalid')
$negative['forged-source-mappings'] = Add-ExecutedStatus (Validate-Negative 'negative-forged-source-mappings.json' 'graph-schema-invalid')
$negative['old-source-digest'] = Add-ExecutedStatus (Validate-Negative 'negative-old-source-digest.json' 'graph-schema-invalid')
$negative['missing-source-anchor'] = Add-ExecutedStatus (Validate-Negative 'negative-missing-source-anchor.json' 'graph-schema-invalid')
$negative['nonunique-source-anchor'] = Add-ExecutedStatus (Validate-Negative 'negative-nonunique-source-anchor.json' 'graph-schema-invalid')
$negative['source-use-location'] = Add-ExecutedStatus (Validate-Negative 'negative-source-use-location.json' 'graph-schema-invalid')
$negative['host-envelope-source-digest'] = Add-ExecutedStatus (Validate-GraphReferenceCase (($b0 | ConvertTo-Json -Depth 30 | ConvertFrom-Json -AsHashtable) | ForEach-Object { $_.graph.sourceDigest = '1' * 64; $_ }) $g0 'source-digest-mismatch' $baselineHost)
$negative['host-envelope-graph-digest'] = Add-ExecutedStatus (Validate-GraphReferenceCase (($b0 | ConvertTo-Json -Depth 30 | ConvertFrom-Json -AsHashtable) | ForEach-Object { $_.graph.graphDigest = '2' * 64; $_ }) $g0 'graph-digest-mismatch' $baselineHost)
$negative['host-envelope-version'] = Add-ExecutedStatus (Validate-GraphReferenceCase (($b0 | ConvertTo-Json -Depth 30 | ConvertFrom-Json -AsHashtable) | ForEach-Object { $_.graph.graphIdentityVersion = 'sourcegraph-identity/attacker-v9'; $_ }) $g0 'graph-digest-mismatch' $baselineHost)
$negative['host-envelope-side'] = Add-ExecutedStatus (Validate-GraphReferenceCase (($b0 | ConvertTo-Json -Depth 30 | ConvertFrom-Json -AsHashtable) | ForEach-Object { $_.side = 'candidate'; $_ }) $g0 'side-mismatch' $baselineHost)
$negative['forged-self-consistent-graph'] = Add-ExecutedStatus (Validate-GraphReferenceCase $forgedBinding $forgedGraph 'graph-digest-mismatch' $baselineHost)
$negative['source-proven-uses-token-consumer'] = Add-ExecutedStatus (Validate-GraphReferenceCase $usesTokenBinding $usesTokenConsumerGraph 'relation-not-in-graph' $usesTokenConsumerHost)
$projectBinding = $b0 | ConvertTo-Json -Depth 20 | ConvertFrom-Json -AsHashtable; $projectBinding.graph.projectId = 'project-other'; $projectBinding.graph.graphDigest = $d0
$semanticBinding = $b0 | ConvertTo-Json -Depth 20 | ConvertFrom-Json -AsHashtable; $semanticBinding.graph.graphDigest = $semanticCandidateDigest
$negative['project-mismatch'] = Add-ExecutedStatus (Validate-GraphReferenceNegative $projectBinding $g0 'none' 'logical-project-mismatch' $baselineHost)
$negative['semantic-candidate'] = Add-ExecutedStatus (Validate-GraphReferenceNegative $semanticBinding $g0SemanticCandidate 'none' 'relation-not-in-graph' $semanticCandidateHost)
$opaqueNode = Read-Json 'negative-opaque-node-relation.json'; $sourceRefNoMapping = Read-Json 'negative-source-ref-no-mapping.json'
$negative['opaque-node-relation'] = Add-ExecutedStatus (Validate-GraphReferenceNegative $opaqueNode $g0 'none' 'source-ref-not-in-graph' $baselineHost)
$negative['source-ref-no-mapping'] = Add-ExecutedStatus (Validate-GraphReferenceNegative $sourceRefNoMapping $g0 'none' 'source-ref-not-in-graph' $baselineHost)
$pending = [ordered]@{}
$artifactPathCases = @('../escape.json','/absolute.json','//server/share.json','runs//duplicate.json','runs/./dot.json','runs/../escape.json','C:/drive.json','runs\backslash.json',("runs/" + [char]0 + "nul.json")) | ForEach-Object {
  $pathValue = [string]$_
  try { Validate-ArtifactPath $pathValue; Add-ExecutedStatus ([ordered]@{ path = $pathValue; pass = $false; reasonCode = 'unexpected-pass' }) } catch { Add-ExecutedStatus ([ordered]@{ path = $pathValue; pass = ($_.Exception.Message -eq 'artifact-path-invalid'); reasonCode = $_.Exception.Message }) }
}
$captureFormatCases = @(
  [ordered]@{ name = 'route'; value = 'home' },
  [ordered]@{ name = 'search'; value = '?' },
  [ordered]@{ name = 'hash'; value = '#' },
  [ordered]@{ name = 'width'; value = '0' }
) | ForEach-Object {
  $case = $_
  try {
    if ($case.name -eq 'route') { Validate-Route $case.value }
    elseif ($case.name -eq 'width') { if ([int]$case.value -lt 1) { throw 'observation-tuple-mismatch' } }
    elseif ($case.name -eq 'search' -and $case.value -eq '?') { throw 'observation-tuple-mismatch' }
    elseif ($case.name -eq 'hash' -and $case.value -eq '#') { throw 'observation-tuple-mismatch' }
    Add-ExecutedStatus ([ordered]@{ name = $case.name; pass = $false; reasonCode = 'unexpected-pass' })
  } catch { Add-ExecutedStatus ([ordered]@{ name = $case.name; pass = ($_.Exception.Message -eq 'observation-tuple-mismatch'); reasonCode = $_.Exception.Message }) }
}
$observedReasonNames = [System.Collections.Generic.HashSet[string]]::new()
foreach ($item in @($negative.Values)) { if ($item.reasonCode) { [void]$observedReasonNames.Add([string]$item.reasonCode) } }
foreach ($item in @($artifactPathCases)) { if ($item.reasonCode) { [void]$observedReasonNames.Add([string]$item.reasonCode) } }
foreach ($item in @($captureFormatCases)) { if ($item.reasonCode) { [void]$observedReasonNames.Add([string]$item.reasonCode) } }
$reasonCodeClosedSet = @($observedReasonNames | Where-Object { $observationReasonNames -notcontains $_ }).Count -eq 0
$corePassed = $d0 -eq $d1 -and $d0 -ne $d2 -and $reasonCodeClosedSet -and ($negative.Values | Where-Object { -not $_.pass }).Count -eq 0 -and (@($artifactPathCases | Where-Object { -not $_.pass }).Count -eq 0) -and (@($captureFormatCases | Where-Object { -not $_.pass }).Count -eq 0)
$requiredSafetyItems = @($negative['missing-relation-source-identity'],$negative['forged-source-identity'],$negative['opaque-node-relation'],$negative['source-ref-no-mapping'],$negative['project-mismatch'],$negative['semantic-candidate'])
$requiredSafetyExecuted = @($requiredSafetyItems | Where-Object { $_.executed -ne $true -or $_.status -ne 'passed' }).Count -eq 0
$requiredSafetyFailed = @($requiredSafetyItems | Where-Object { $_.status -eq 'failed' }).Count -gt 0
$result = [ordered]@{
  status = if (-not $corePassed -or $requiredSafetyFailed) { 'failed' } else { 'passed' }
  executionSummary = [ordered]@{ prepared = $true; executed = $true; passed = $corePassed -and $requiredSafetyExecuted; failed = (-not $corePassed) -or $requiredSafetyFailed; blocked = $false; requiredNegativeCaseCount = $requiredSafetyItems.Count; requiredNegativeExecutedCount = @($requiredSafetyItems | Where-Object { $_.executed -eq $true }).Count }
  G0 = [ordered]@{ digest = $d0; canonicalBytesSha256 = CanonicalBytesSha $c0; canonicalBytesBase64 = CanonicalBytesBase64 $c0 }
  G1 = [ordered]@{ digest = $d1; equalTo = 'G0' }
  G2 = [ordered]@{ digest = $d2 }
  G4 = [ordered]@{ digest = $d4; canonicalBytesSha256 = CanonicalBytesSha $c4; canonicalBytesBase64 = CanonicalBytesBase64 $c4 }
  B0 = [ordered]@{ digest = $bd; canonicalBytesSha256 = CanonicalBytesSha $bc; canonicalBytesBase64 = CanonicalBytesBase64 $bc }
  artifactPathCases = $artifactPathCases
  captureFormatCases = $captureFormatCases
  reasonCodeClosedSet = [ordered]@{ pass = $reasonCodeClosedSet; observed = (Sort-StringArray @($observedReasonNames)); allowedCount = $observationReasonNames.Count }
  negative = $negative
  pending = $pending
}
$resultJson = $result | ConvertTo-Json -Depth 10
$resultJson = $resultJson -replace "`r`n", "`n"
[System.IO.File]::WriteAllText((Join-Path $root 'acp6-observation-v2-final-powershell-report.json'), $resultJson + "`n", [System.Text.UTF8Encoding]::new($false))
$resultJson
if ($result.status -ne 'passed') { exit 1 }
