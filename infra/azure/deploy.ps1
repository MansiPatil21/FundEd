#Requires -Version 7
<#
.SYNOPSIS
    First deployment of the optimizer to Azure Container Apps, then a smoke test.

.DESCRIPTION
    The container app needs an image to exist, and the registry that holds the image is created by
    the same Terraform configuration. So the deployment runs in three steps: create the registry
    and identities, build and push the image, then apply everything else. After this first run the
    GitHub Actions workflow owns image deployments.

    Finishes by proving the security posture from outside: /health answers, a planning request
    without the Key Vault-backed key is refused with 401, and one with it succeeds.

.EXAMPLE
    ./deploy.ps1 -SubscriptionId 00000000-0000-0000-0000-000000000000
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $SubscriptionId,
    [string] $Environment = 'dev',
    [string] $ImageTag = 'initial',
    [switch] $SetGitHubVariables
)

$ErrorActionPreference = 'Stop'
$InformationPreference = 'Continue'
Set-StrictMode -Version Latest
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '../..')

function Invoke-Checked {
    param([Parameter(Mandatory)] [string] $Command, [string[]] $Arguments = @())
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

Push-Location $PSScriptRoot
try {
    if (-not (Test-Path backend.hcl)) { throw 'backend.hcl not found. Run ./bootstrap.ps1 first.' }

    # The state account's names come from backend.hcl, so the pipeline identities can be granted access to it.
    $backend = @{}
    foreach ($line in Get-Content backend.hcl) {
        if ($line -match '^\s*(\w+)\s*=\s*"?([^"]*)"?\s*$') { $backend[$Matches[1]] = $Matches[2] }
    }
    $tfVars = @("-var=subscription_id=$SubscriptionId", "-var=environment=$Environment", "-var=image_tag=$ImageTag",
        "-var=state_resource_group=$($backend['resource_group_name'])", "-var=state_storage_account=$($backend['storage_account_name'])")

    Invoke-Checked terraform @('init', '-input=false', '-backend-config=backend.hcl')

    Write-Information '== Step 1 of 3: registry and identities'
    Invoke-Checked terraform (@('apply', '-input=false', '-auto-approve',
        '-target=azurerm_container_registry.main', '-target=azurerm_user_assigned_identity.app',
        '-target=azurerm_role_assignment.app_acr_pull') + $tfVars)

    $registry = terraform output -raw acr_login_server
    $registryName = terraform output -raw acr_name

    Write-Information "== Step 2 of 3: build and push $registry/funded-optimizer:$ImageTag"
    Invoke-Checked az @('acr', 'login', '--name', $registryName)
    # linux/amd64 explicitly: Container Apps runs amd64, and an image built natively on an
    # Apple Silicon Mac would be arm64 and fail to start with an exec format error.
    Invoke-Checked docker @('buildx', 'build', '--platform', 'linux/amd64', '--push',
        '--tag', "$registry/funded-optimizer:$ImageTag", (Join-Path $repoRoot 'optimizer'))

    Write-Information '== Step 3 of 3: everything else'
    # Azure Resource Manager occasionally resets a connection mid-create. Terraform records what it
    # finished, so re-applying picks up exactly where the dropped request left off.
    foreach ($attempt in 1..3) {
        & terraform (@('apply', '-input=false', '-auto-approve') + $tfVars)
        if ($LASTEXITCODE -eq 0) { break }
        if ($attempt -eq 3) { throw 'terraform apply failed after 3 attempts' }
        Write-Information "terraform apply attempt $attempt failed, retrying in 20 seconds..."
        Start-Sleep -Seconds 20
    }

    $url = terraform output -raw optimizer_url
    $vault = terraform output -raw key_vault_name

    if ($SetGitHubVariables) {
        $repo = 'MansiPatil21/FundEd'
        foreach ($pair in @(
                @('AZURE_CLIENT_ID', (terraform output -raw github_azure_client_id)),
                @('AZURE_TENANT_ID', (terraform output -raw github_azure_tenant_id)),
                @('AZURE_SUBSCRIPTION_ID', (terraform output -raw github_azure_subscription_id)),
                @('AZURE_RESOURCE_GROUP', (terraform output -raw resource_group)),
                @('AZURE_CONTAINER_APP', (terraform output -raw container_app_name)),
                @('AZURE_ACR_NAME', $registryName),
                @('AZURE_KEY_VAULT', $vault),
                @('AZURE_TF_PLAN_CLIENT_ID', (terraform output -raw github_terraform_plan_client_id)),
                @('AZURE_TF_APPLY_CLIENT_ID', (terraform output -raw github_terraform_apply_client_id)),
                @('TF_STATE_RESOURCE_GROUP', $backend['resource_group_name']),
                @('TF_STATE_STORAGE_ACCOUNT', $backend['storage_account_name']))) {
            Invoke-Checked gh @('variable', 'set', $pair[0], '--repo', $repo, '--body', $pair[1])
        }
        Write-Information 'Set GitHub repository variables for the deploy workflow (identifiers, not secrets).'
    }

    Write-Information "== Smoke test $url"
    $health = $null
    foreach ($attempt in 1..30) {
        # Scale-to-zero means the first request after deploy waits for a cold start.
        try { $health = Invoke-RestMethod -Uri "$url/health" -TimeoutSec 20; break } catch { Start-Sleep -Seconds 10 }
    }
    if ($health.status -ne 'ok') { throw "health check failed at $url/health" }
    Write-Information '  /health ok'

    $body = @{
        periods               = @(@{ on = '2027-01-01'; rate = 60.0 }, @{ on = '2027-01-02'; rate = 62.0 })
        obligations           = @(@{ label = 'rent'; due_on = '2027-01-02'; amount_minor = 620000 })
        fees                  = @{ fixed_minor = 0; variable_bps = 0 }
        opening_balance_minor = 1000000
    } | ConvertTo-Json -Depth 5

    $anonymous = Invoke-WebRequest -Uri "$url/plan" -Method Post -Body $body -ContentType 'application/json' -SkipHttpErrorCheck
    if ($anonymous.StatusCode -ne 401) { throw "expected 401 without the API key, got $($anonymous.StatusCode)" }
    Write-Information '  /plan without key -> 401'

    $key = Invoke-Checked az @('keyvault', 'secret', 'show', '--vault-name', $vault, '--name', 'optimizer-api-key', '--query', 'value', '--output', 'tsv')
    $authorised = Invoke-RestMethod -Uri "$url/plan" -Method Post -Body $body -ContentType 'application/json' -Headers @{ 'x-api-key' = $key }
    Write-Information "  /plan with the Key Vault key -> $($authorised.status)"
}
finally {
    Pop-Location
}
