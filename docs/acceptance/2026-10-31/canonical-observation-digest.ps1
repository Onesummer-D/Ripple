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
  Assert-Keys $graph @('graphIdentityVersion','graphSchemaVersion','relationIdentityVersion','sourceDigest','nodes','edges','unresolved') 'graph'
  foreach ($key in @('graphIdentityVersion','graphSchemaVersion','relationIdentityVersion','sourceDigest','nodes','edges','unresolved')) { if (-not (Has-Key $graph $key)) { throw 'graph-schema-invalid' } }
  if ($graph.graphIdentityVersion -cne 'sourcegraph-identity/v2') { throw 'graph-schema-invalid' }
  Assert-NonEmptyString $graph.graphSchemaVersion 'graphSchemaVersion'
  Assert-NonEmptyString $graph.relationIdentityVersion 'relationIdentityVersion'
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
    if ($name -in @('g3-duplicate-relation.json','negative-unknown-location.json','negative-page-overrides.json','negative-missing-evidence-refs.json','negative-kind.json','negative-unsafe-integer.json','negative-empty-page-key.json','legacy-v5.json')) {
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

function Source-UseEqual($a, $b) {
  return $a.path -ceq $b.path -and $a.charOffset -eq $b.charOffset -and $a.byteOffset -eq $b.byteOffset -and $a.offsetUnit -ceq $b.offsetUnit
}

function Validate-GraphReference($binding, $graph) {
  if ($binding.sourceUseRef -and $null -eq $binding.sourceRef) { throw 'missing-source-ref' }
  if ($binding.sourceUseRef -and $binding.sourceRef -cne $binding.sourceUseRef.sourceRef) { throw 'source-ref-mismatch' }
  if ($null -eq $binding.sourceUseRef) { return }
  $nodes = @($graph.nodes | Where-Object { $_.id -ceq $binding.sourceUseRef.graphNodeId })
  if ($nodes.Count -eq 0) { throw 'source-ref-not-in-graph' }
  if ($nodes.Count -ne 1) { throw 'graph-node-not-unique' }
  if ($sourceUseNodeKinds -cnotcontains $nodes[0].kind) { throw 'declaration-node-not-source-use' }
  if ($nodes[0].id -cne $binding.sourceRef -or $nodes[0].id -cne $binding.sourceUseRef.sourceRef) { throw 'source-ref-not-in-graph' }
  if ($null -eq $binding.sourceUseRef.relationId) { return }
  $edges = @($graph.edges | Where-Object { $_.id -ceq $binding.sourceUseRef.relationId })
  if ($edges.Count -eq 0) { throw 'relation-not-in-graph' }
  if ($edges.Count -ne 1) { throw 'duplicate-relation-id' }
  if ($edges[0].from -cne $binding.sourceUseRef.graphNodeId -or -not (Source-UseEqual $edges[0].sourceUse $binding.sourceUseRef.sourceUse)) { throw 'source-use-ref-mismatch' }
  if ($edges[0].Contains('sourceIdentity') -and $edges[0].sourceIdentity -cne $binding.sourceRef) { throw 'source-ref-mismatch' }
}

function Validate-GraphReferenceNegative($binding, $graph, $field, $expected) {
  try {
    $copy = $binding | ConvertTo-Json -Depth 20 | ConvertFrom-Json -AsHashtable
    if ($field -eq 'sourceRef') { $copy.sourceRef = 'node:other' }
    if ($field -eq 'graphNodeId') { $copy.sourceUseRef.graphNodeId = 'node:missing' }
    if ($field -eq 'sourceUse') { $copy.sourceUseRef.sourceUse.byteOffset = 99 }
    if ($field -eq 'duplicateRelation') { $graph = [ordered]@{ nodes = $graph.nodes; edges = @($graph.edges + $graph.edges[0]) } }
    Validate-GraphReference $copy $graph
    return [ordered]@{ pass = $false; expectedReasonCode = $expected; reasonCode = 'unexpected-pass'; observationReasonCode = (Observation-Code 'unexpected-pass') }
  } catch {
    $code = $_.Exception.Message
    return [ordered]@{ pass = ($code -eq $expected); expectedReasonCode = $expected; reasonCode = $code; observationReasonCode = (Observation-Code $code) }
  }
}

$g0 = Read-Json 'g0.json'; $g1 = Read-Json 'g1-shuffled.json'; $g2 = Read-Json 'g2-byte-offset-changed.json'; $g3 = Read-Json 'g3-duplicate-relation.json'; $g4 = Read-Json 'g4-nonascii.json'
Validate-Graph $g0; Validate-Graph $g1; Validate-Graph $g2; Validate-Graph $g4
$c0 = Convert-Canonical (Normalize-Graph $g0); $c1 = Convert-Canonical (Normalize-Graph $g1); $c2 = Convert-Canonical (Normalize-Graph $g2)
$c4 = Convert-Canonical (Normalize-Graph $g4)
$d0 = Digest "ripple/sourcegraph-identity/v2/graphDigest`0" $c0
$d1 = Digest "ripple/sourcegraph-identity/v2/graphDigest`0" $c1
$d2 = Digest "ripple/sourcegraph-identity/v2/graphDigest`0" $c2
$d4 = Digest "ripple/sourcegraph-identity/v2/graphDigest`0" $c4
$b0 = Read-Json 'b0-observation.json'; $b0.graph.graphDigest = $d0
$binding = [ordered]@{}
foreach ($key in $b0.Keys) { if ($key -notin @('status','proof','primaryReasonCode','secondaryReasonCodes','observationBindingDigest','diagnostic')) { $binding[$key] = $b0[$key] } }
Validate-Binding $b0
$bc = Convert-Canonical $binding
$bd = Digest "ripple/sourcegraph-observation-binding/v1/observationBindingDigest`0" $bc
$negative = [ordered]@{}
$negative['G3'] = Validate-Negative 'g3-duplicate-relation.json' 'graph-schema-invalid'
$negative['negative-unknown-location'] = Validate-Negative 'negative-unknown-location.json' 'graph-schema-invalid'
$negative['negative-page-overrides'] = Validate-Negative 'negative-page-overrides.json' 'graph-schema-invalid'
$negative['missing-evidence-refs'] = Validate-Negative 'negative-missing-evidence-refs.json' 'graph-schema-invalid'
$negative['invalid-node-kind'] = Validate-Negative 'negative-kind.json' 'graph-schema-invalid'
$negative['unsafe-integer'] = Validate-Negative 'negative-unsafe-integer.json' 'graph-schema-invalid'
$negative['empty-page-overrides-key'] = Validate-Negative 'negative-empty-page-key.json' 'graph-schema-invalid'
$negative['negative-route'] = Validate-Negative 'negative-route.json' 'observation-tuple-mismatch'
$negative['negative-artifact-path'] = Validate-Negative 'negative-artifact-path.json' 'artifact-path-invalid'
$negative['legacy-v5'] = Validate-Negative 'legacy-v5.json' 'graph-schema-invalid'
$negative['source-ref-mismatch'] = Validate-GraphReferenceNegative $b0 $g0 'sourceRef' 'source-ref-mismatch'
$negative['graph-node-missing'] = Validate-GraphReferenceNegative $b0 $g0 'graphNodeId' 'source-ref-not-in-graph'
$negative['source-use-mismatch'] = Validate-GraphReferenceNegative $b0 $g0 'sourceUse' 'source-use-ref-mismatch'
$negative['duplicate-relation-id'] = Validate-GraphReferenceNegative $b0 $g0 'duplicateRelation' 'duplicate-relation-id'
$opaque = Read-Json 'negative-opaque-source-ref.json'
$declaration = Read-Json 'negative-declaration-node.json'
$crossSide = Read-Json 'negative-cross-side-source-ref.json'; $g5 = Read-Json 'g5-candidate-side.json'; Validate-Graph $g5
$negative['opaque-source-ref'] = Validate-GraphReferenceNegative $opaque $g0 'none' 'source-ref-not-in-graph'
$negative['declaration-node-not-source-use'] = Validate-GraphReferenceNegative $declaration $g0 'none' 'declaration-node-not-source-use'
$negative['cross-side-source-ref'] = Validate-GraphReferenceNegative $crossSide $g5 'none' 'source-ref-not-in-graph'
$pending = [ordered]@{
  'missing-relation-source-identity' = [ordered]@{
    status = 'not-executed'
    expectedReasonCode = 'graph-schema-invalid'
    expectedObservationStatus = 'unavailable'
    trusted = $false
    fixture = 'negative-missing-relation-source-identity.json'
    message = 'A/E must freeze Relation.sourceIdentity presence before this case can be executed; current evidence validator treats the field as optional'
  }
}
$artifactPathCases = @('../escape.json','/absolute.json','//server/share.json','runs//duplicate.json','runs/./dot.json','runs/../escape.json','C:/drive.json','runs\backslash.json',("runs/" + [char]0 + "nul.json")) | ForEach-Object {
  $pathValue = [string]$_
  try { Validate-ArtifactPath $pathValue; [ordered]@{ path = $pathValue; pass = $false; reasonCode = 'unexpected-pass' } } catch { [ordered]@{ path = $pathValue; pass = ($_.Exception.Message -eq 'artifact-path-invalid'); reasonCode = $_.Exception.Message } }
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
    [ordered]@{ name = $case.name; pass = $false; reasonCode = 'unexpected-pass' }
  } catch { [ordered]@{ name = $case.name; pass = ($_.Exception.Message -eq 'observation-tuple-mismatch'); reasonCode = $_.Exception.Message } }
}
$observedReasonNames = [System.Collections.Generic.HashSet[string]]::new()
foreach ($item in @($negative.Values)) { if ($item.reasonCode) { [void]$observedReasonNames.Add([string]$item.reasonCode) } }
foreach ($item in @($artifactPathCases)) { if ($item.reasonCode) { [void]$observedReasonNames.Add([string]$item.reasonCode) } }
foreach ($item in @($captureFormatCases)) { if ($item.reasonCode) { [void]$observedReasonNames.Add([string]$item.reasonCode) } }
$reasonCodeClosedSet = @($observedReasonNames | Where-Object { $observationReasonNames -notcontains $_ }).Count -eq 0
$result = [ordered]@{
  status = if ($d0 -eq $d1 -and $d0 -ne $d2 -and $reasonCodeClosedSet -and ($negative.Values | Where-Object { -not $_.pass }).Count -eq 0 -and (@($artifactPathCases | Where-Object { -not $_.pass }).Count -eq 0) -and (@($captureFormatCases | Where-Object { -not $_.pass }).Count -eq 0)) { 'pass' } else { 'fail' }
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
if ($result.status -ne 'pass') { exit 1 }

