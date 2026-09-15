#Requires -Version 7
<#
.SYNOPSIS
    One-time setup that must exist before Terraform can run: resource providers and remote state.

.DESCRIPTION
    Terraform cannot keep its state in a storage account it has not created yet, so this script
    creates that account first. It is an ADLS Gen2 account (hierarchical namespace on), with
    public blob access off, TLS 1.2 minimum, and 7-day soft delete so a deleted state file can be
    recovered. It also registers the resource providers the deployment uses, which a new
    subscription, a student one especially, often has unregistered.

    Idempotent: safe to run again. Writes backend.hcl for `terraform init -backend-config`.

.EXAMPLE
    ./bootstrap.ps1 -Location canadacentral
#>
[CmdletBinding()]
param(
    [string] $Location = 'canadacentral',
    [string] $StateResourceGroup = 'rg-funded-tfstate'
)

$ErrorActionPreference = 'Stop'
$InformationPreference = 'Continue'
Set-StrictMode -Version Latest

function Invoke-Az {
    # The Azure CLI reports failure through its exit code, which PowerShell does not turn into
    # an exception on its own. Without this check a failed step would print an error and the
    # script would carry on as if it had worked.
    $output = & az @args
    if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') failed with exit code $LASTEXITCODE" }
    return $output
}

$account = Invoke-Az account show --output json | ConvertFrom-Json
Write-Information "Subscription: $($account.name) ($($account.id))"

$providers = @(
    'Microsoft.App', 'Microsoft.ContainerRegistry', 'Microsoft.KeyVault', 'Microsoft.ManagedIdentity',
    'Microsoft.OperationalInsights', 'Microsoft.PolicyInsights', 'Microsoft.Storage', 'Microsoft.Insights'
)
foreach ($provider in $providers) {
    $state = Invoke-Az provider show --namespace $provider --query registrationState --output tsv
    if ($state -ne 'Registered') {
        Write-Information "Registering $provider ($state)..."
        Invoke-Az provider register --namespace $provider --wait | Out-Null
    }
}
Write-Information "All $($providers.Count) resource providers registered."

Invoke-Az group create --name $StateResourceGroup --location $Location `
    --tags project=funded managed_by=bootstrap --output none

# Storage account names are global, 3 to 24 lowercase letters and digits. Derive a stable one from
# the subscription id so reruns find the same account instead of creating another.
$suffix = ($account.id -replace '-', '').Substring(0, 10)
$storageAccount = "stfundedstate$suffix"

$existing = Invoke-Az storage account list --resource-group $StateResourceGroup --query "[?name=='$storageAccount'].name" --output tsv
if (-not $existing) {
    Write-Information "Creating ADLS Gen2 state account $storageAccount..."
    Invoke-Az storage account create `
        --name $storageAccount --resource-group $StateResourceGroup --location $Location `
        --sku Standard_LRS --kind StorageV2 --hns true `
        --min-tls-version TLS1_2 --allow-blob-public-access false `
        --tags project=funded managed_by=bootstrap --output none
}

# Blob versioning is not available on ADLS Gen2 (hierarchical namespace) accounts, so a deleted or
# overwritten state blob is protected with soft delete instead: recoverable for 7 days.
Invoke-Az storage account blob-service-properties update `
    --account-name $storageAccount --resource-group $StateResourceGroup `
    --enable-delete-retention true --delete-retention-days 7 `
    --enable-container-delete-retention true --container-delete-retention-days 7 --output none

# Terraform authenticates to the state container with Entra ID rather than an account key, so the
# signed-in user needs data-plane rights on it.
$me = Invoke-Az ad signed-in-user show --query id --output tsv
$accountId = Invoke-Az storage account show --name $storageAccount --resource-group $StateResourceGroup --query id --output tsv
$hasRole = Invoke-Az role assignment list --assignee $me --scope $accountId --role 'Storage Blob Data Contributor' --query '[0].id' --output tsv
if (-not $hasRole) {
    Invoke-Az role assignment create --assignee-object-id $me --assignee-principal-type User `
        --role 'Storage Blob Data Contributor' --scope $accountId --output none
    Write-Information 'Granted Storage Blob Data Contributor on the state account (allow a minute to propagate).'
}

# The data-plane role above can take a minute to reach the storage service, and creating the
# container with Entra ID auth before it does fails with AuthorizationPermissionMismatch.
foreach ($attempt in 1..12) {
    & az storage container create --name tfstate --account-name $storageAccount --auth-mode login --output none 2>$null
    if ($LASTEXITCODE -eq 0) { break }
    if ($attempt -eq 12) { throw 'could not create the tfstate container after waiting for role propagation' }
    Write-Information 'Waiting for storage data-plane permissions to propagate...'
    Start-Sleep -Seconds 10
}

$backend = @"
resource_group_name  = "$StateResourceGroup"
storage_account_name = "$storageAccount"
container_name       = "tfstate"
key                  = "funded-azure.tfstate"
use_azuread_auth     = true
"@
Set-Content -Path (Join-Path $PSScriptRoot 'backend.hcl') -Value $backend

Write-Information "Wrote backend.hcl. Next: ./deploy.ps1 -SubscriptionId $($account.id)"
