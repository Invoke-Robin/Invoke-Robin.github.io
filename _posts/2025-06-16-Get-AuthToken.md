---
title: "The Graph Series - Part One: Painless authentication to the Graph API"
date: 2025-06-16
author: Robin Gustavsson
summary: "Authenticating painlessly with Graph"
tags: [Graph, .NET, MSAL]
---

<!-- omit from toc -->
# Table of Contents

- [Introduction](#introduction)
- [Foreword](#foreword)
- [Building the Get-AuthToken function](#building-the-get-authtoken-function)
  - [Creating the function and its parameters](#creating-the-function-and-its-parameters)
  - [Dependencies](#dependencies)
  - [Preparing to authenticate](#preparing-to-authenticate)
  - [Creating the module scoped MSAL app for authentication](#creating-the-module-scoped-msal-app-for-authentication)
  - [Retrieve token from MSAL](#retrieve-token-from-msal)
  - [Finalizing, and Managed Identity](#finalizing-and-managed-identity)
  - [Final form](#final-form)
- [Example usage](#example-usage)
- [Conclusion](#conclusion)

# Introduction

The first part of the Graph series will kick off on how to authenticate to the Graph API.  
There is some history to this function, if you're interested in how I ended up here, feel free to read the introduction first, albeit not necessary to understand what's going on in this post!

The function was created to easily manage authentication to Graph with MSAL. It supports connections to multiple tenants at the same time, and it very tightly knits together with `Invoke-RestRequest` function which is supposed to make life easier when doing Graph API calls.

This function isn't designed to be loaded on its own, it relies on module scoped variables and its integration with `Invoke-RestMethod` (covered in the next post).

# Foreword

I will be talking about the module scope in this post, if you don't know what that is I will describe it briefly here beforehand, but I won't go into much detail here as I don't think it's within this posts scope (ba dum tss!).  

Very short version: In PowerShell, variables can be scoped into basically three scopes; local, script or global
- Local (Default `$variable`): available only inside the function or scriptblock/function
- Global (`$global:variable`): available everywhere in the session
- Script/Module (`$script:variable`): available everywhere within the scripts session, if you create it within a function it's available outside of it as well. However, using a script scoped variable within a module makes it available for **all** scripts within that module.
  - There is no `$module:`, it's just referred to as the module scope when using the script scope within a module.

There is of course more to be learned about this, if anyone's interested I could make a longer blog post talking about this, and give examples on how to try out how the different scopes work.  
I will leave you two references, the first one where I discovered this: [Mike F Robbins blog](https://mikefrobbins.com/2017/06/08/what-is-this-module-scope-in-powershell-that-you-speak-of/), and of course the Microsoft documentation [about_Scopes](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_scopes?view=powershell-7.5)

# Building the Get-AuthToken function

## Creating the function and its parameters

Let's start off by making a function, call it what you want but I call mine Get-AuthToken, we're going to make it an advanced function with the [cmdletbinding()] attribute and create some parameters that we need for authentication and other functionality in the function. There is also two **parametersets**, one for **delegated access** and one for **managed identity**. Most of the time you're probably going to use delegated access, managed identity is used for automation in Azure Functions.  
The first part of the function should look something like this:

```powershell
function Get-AuthToken {
    [CmdletBinding(DefaultParameterSetName = 'DelegatedAccess')]
    param(
        [Parameter(Mandatory = $false, ParameterSetName = 'DelegatedAccess')]
        [string]$TenantUri = $script:Tenant,

        [Parameter(ParameterSetName = 'DelegatedAccess')]
        [switch]$PassThru,

        [Parameter(ParameterSetName = 'DelegatedAccess')]
        [string]$TenantDomain = '.onmicrosoft.com',

        [Parameter(ParameterSetName = 'DelegatedAccess')]
        [string]$ClientId = '14d82eec-204b-4c2f-b7e8-296a70dab67e',

        [Parameter(ParameterSetName = 'DelegatedAccess')]
        [hashtable]$AuthHeader = $script:AuthToken,

        [Parameter(ParameterSetName = 'DelegatedAccess')]
        [Parameter(ParameterSetName = 'ManagedIdentity')]
        [string[]]$Scopes = @('.default'),

        [Parameter(ParameterSetName = 'DelegatedAccess')]
        [string]$RedirectUri = 'http://localhost',

        [Parameter(ParameterSetName = 'ManagedIdentity')]
        [switch]$Identity
    )
}
```

I'll describe the parameters and why they're needed:
| Parameter    | Type                     | Description                                                                                                                                                                                                                                                                               |
| ------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TenantUri    | string                   | This is the Azure Authority URI for the tenant you wish to authenticate to, it can be assigned as a parameter or inside a script as variable.                                                                                                                                             |
| PassThru     | switch                   | A switch parameter, when specified, returns the authentication token object (AuthHeader).                                                                                                                                                                                                 |
| TenantDomain | string                   | This is the tenant domain information, will be paired with TenantUri if it's missing the full domain name.                                                                                                                                                                                |
| ClientId     | string                   | This is the client ID of the application you want to authenticate with, I'm using the default one for PowerShell Graph that exists in all tenants as an example in this case, this is a well known ID. You can override this value by assigning the parameter when you call the function. |
| AuthHeader   | hashtable                | A hashtable containing at least the bearer token. This will probably make more sense later, but this is the object in which the bearer token for authentication exists in, it will be reused in the module scope for easier management of the token.                                      |
| Scopes       | string\[] (string array) | This parameter is a string array where you specify which permissions you want to authenticate with. In this example, I use `.default` as the scope, which connects to Graph with all permissions that has been granted on the application (ClientID) and that your account has access to. |
| RedirectUri  | string                   | This is the RedirectUri which the MSAL app uses to redirect after authentication.                                                                                                                                                                                                         |
| Identity     | switch                   | This is a switch param, when used it will assume you're in a azure automation script and do some voodo magic to authenticate automatically from the automation script.                                                                                                                    |

## Dependencies

Now, we can get to the next part, dependencies!  
Something that I've had on my radar for a while, but haven't had the time to really sit down and figure out a good solution for: This script is dependent on the `Microsoft.Graph.Authentication` module, it has some DLL's that need to be imported into the session. What I would really like to do at some point is to automate the extraction of the needed DLL's in to the module itself. The solution at this time is to host the `Microsoft.Graph.Authentication` module in our own **Azure DevOps Artifact** and download it from there with our ultra fast module installer function!

Anyways, here is the code for module dependencies:

```powershell
# Checking for module dependencies
Write-Verbose 'Checking for module dependencies.'
if ($Identity -eq $false) {
    Install-DevOpsModule -Name 'Microsoft.Graph.Authentication'
}

# Setting the module scope Managed Identity variable for Invoke-RestRequest
if ($Identity -eq $true) {
    $script:ManagedIdentitySwitch = $true
} else {
    $script:ManagedIdentitySwitch = $false
}

# Checking for and adding assembly dependencies
# Check if the microsoft.identity.client.dll is loaded, if not load it
Write-Verbose 'Checking for assembly dependencies.'
if (-not ([System.AppDomain]::CurrentDomain.GetAssemblies().FullName -match 'Microsoft.Identity.Client')) {
    Write-Verbose 'No Microsoft.Identity.Client assembly found. Loading assembly and dependencies from Microsoft.Graph.Authentication module.'
    Import-Module Microsoft.Graph.Authentication -Force
    $MSAuthModuleLocation = Get-Module Microsoft.Graph.Authentication | Select-Object -Expand ModuleBase
    If ($PSVersionTable.PSVersion.Major -le 5) {
        $MSAuthModuleDependencies = (Get-ChildItem -Path "$MSAuthModuleLocation\Dependencies" -File).FullName
        $MSAuthModuleDependencies += (Get-ChildItem -Path "$MSAuthModuleLocation\Dependencies\Desktop" -File).FullName
    } else {
        $MSAuthModuleDependencies = (Get-ChildItem -Path $MSAuthModuleLocation -Filter '*.dll' -Recurse).FullName
    }

    foreach ($Dependency in $MSAuthModuleDependencies) {
        try {
            Add-Type -Path $Dependency
        } catch {
            $FileName = Split-Path -Path $Dependency -Leaf
            Write-Verbose "Could not load $FileName"
        }
    }
}
```

When specifying **Identity** the `Microsoft.Graph.Authentication` module should not be installed, since it's already added to our Azure Automation account beforehand.

We now also specify a very important module scoped variable: **ManagedIdentitySwitch**. This will become clear when I cover this part on the next post, the `Invoke-RestRequest` function!  
We check if the assemblies needed are loaded in the session, if not, import the necessary module, find its base and import the needed DLL files into the session. I've made a distinction here on the PowerShell version, which I could probably solve by just [void]-ing the Add-Type command, but that isn't a very clean way to do it in my opinion.  
I came to the conclusion when debugging the code that Windows PowerShell didn't like someny of DLL's in the root of the `Microsoft.Graph.Authentication` folder, and if I remember correctly, they were needed in PowerShell.

With dependencies out of the way we can finally get to the good stuff!

## Preparing to authenticate

We will be mainly focusing on the Delegated Access part of this function, the Managed Identity part has very little code and almost no logic to it.  
To separate the Delegated Access/Managed Identity parameter scopes, we create a switch statement. Then we define some default values to variables that we're going to use for authentication:

```powershell
switch ($PSCmdlet.ParameterSetName) {
    'ManagedIdentity' {
        # In here will go the code for authenticating with Managed Identity switch
    }
    'DelegatedAccess' {
        $Token = $null
        $DateTime = (Get-Date).ToUniversalTime()

        if (-not ($TenantUri)) {
            $TenantUri = $(Write-Host 'Please specify tenant you wish to access:';Read-Host)
        }

        if (-not ($TenantUri -match 'onmicrosoft')) { $TenantUri = $TenantUri + $TenantDomain }

        $script:Tenant = $TenantUri
        $FriendlyTenant = $TenantUri -Split '\.' | Select-Object -First 1
    }
}
```

We set the `DateTime` variable to Universal Time since that's the time zone that Graph uses. We also prepare the tenanturi variable for the authority, and create a FriendlyTenant variable for creating dynamic variables further down into the function.

## Creating the module scoped MSAL app for authentication

Now we create the MSAL app for the session, this will be created in the **script scope**, since this function is part of a module the script scope is also called the module scope (see [Foreword](#foreword) for more information), any variables declared in the script scope like this $script:variablename will be sent to the module scope, which is accessible through the module as long as it's loaded into the session. This makes it so that we can reuse the MSAL app(s) for multiple purposes and within the module itself.

```powershell
Write-Verbose "Checking if an existing MSAL Application exists for the [$FriendlyTenant] tenant"
$Authority = "https://login.microsoftonline.com/$TenantUri"
$SessionApp = Get-Variable -Name "App$FriendlyTenant" -Scope script -ValueOnly -ErrorAction SilentlyContinue
if (-not $SessionApp) {
    Write-Verbose 'No MSAL Application for this tenant, creating one in the module scope'
    $SessionAppParams = @{
        Name  = "App$FriendlyTenant"
        Value = $([Microsoft.Identity.Client.PublicClientApplicationBuilder]::Create($ClientId).WithAuthority($Authority).WithRedirectUri($RedirectUri).Build())
        Scope = 'Script'
    }
    New-Variable @SessionAppParams
    $SessionApp = Get-Variable -Name "App$FriendlyTenant" -Scope script -ValueOnly -ErrorAction SilentlyContinue
}
```

This code will create a new MSAL application named "App*Tenant*" with the object MSAL class `[Microsoft.Identity.Client.PublicClientApplicationBuidler]`, we create this object with the constructors that contains **ClientID**, **Authority** and **RedirectUri**, then build the app. Then it's saved to the module scope for later use within the session. The newly created module scope App*Tenant* variable is retrieved to a `$SessionApp` variable for easier access later on.

## Retrieve token from MSAL

The next part will retrieve a token from MSAL:

```powershell
$ShouldRefreshMSALToken = (($AuthHeader.ExpiresOn -lt $DateTime.AddMinutes(5)) -or ($null -eq $AuthHeader) -or ($AuthHeader.Tenant -ne $TenantUri))
if ($ShouldRefreshMSALToken) {
    Write-Verbose 'Gathering MSAL cached accounts, and trying to refresh the token'
    $Accounts = $SessionApp.GetAccountsAsync().Result
    $Token = $SessionApp.AcquireTokenSilent([string[]]$Scopes, $Accounts[0]).ExecuteAsync().Result

    if ($null -eq $Token) {
        try {
            Write-Verbose 'No cached accounts, acquiring token interactively'
            $Token = $SessionApp.AcquireTokenInteractive([string[]]$Scopes).ExecuteAsync().Result
        } catch {
            Write-Error "An unexpected error occurred: $_"
        }
    }

    if ($null -eq $AuthHeader) {
        $AuthHeader = @{}
    }

    if ($AuthHeader.ContainsKey('Authorization')) {
        $AuthHeader.Authorization = $Token.CreateAuthorizationHeader()
    } else {
        $AuthHeader.Add('Authorization', $Token.CreateAuthorizationHeader())
    }

    if ($AuthHeader.ContainsKey('ExpiresOn')) {
        $AuthHeader.ExpiresOn = $Token.ExpiresOn
    } else {
        $AuthHeader.Add('ExpiresOn', $Token.ExpiresOn)
    }

    if ($AuthHeader.ContainsKey('Tenant')) {
        $AuthHeader.Tenant = $TenantUri
    } else {
        $AuthHeader.Add('Tenant', $TenantUri)
    }
} else {
    Write-Verbose "Token is still valid for $(($AuthHeader.ExpiresOn - $DateTime).Minutes) minutes"
}
```

In the MSAL docs it says that you don't need to check for expiration because MSAL will handle that automatically, fine by me I thought and removed the code that checks for expiration, but I very quickly learned that I needed to check for expiration because otherwise MSAL will dislike me and start to throw errors about spamming and then won't let me authenticate again until I start a new session.

The `$ShouldRefreshMSALToken` variable does this:

- Checks if the MSALToken **expires within** 5 minutes
- If there is **no** AuthHeader in the session
- If the AuthHeaders tenant is **NOT** the TenantUri specified when calling the function `Get-AuthToken`

If **ANY** of these statements are true, then a new MSAL token should be created _or_ refreshed!

To determine if the token should be created or refreshed, we check for accounts within the app itself, we do this by using the module scoped `$SessionApp` variable, with the method `.GetTokenAsync().Result`, we then try to acquire a token silently by using the method `$Token = $SessionApp.AcquireTokenSilent([string[]]$Scopes, $Accounts[0]).ExecuteAsync().Result`, here we specify the scopes and the last account used on this app. This should retrieve a token if a connection exists, it's null if it doesn't exist, then we call the `AcquireTokenInteractive()` method instead.

_As a sidenote I would at some point like to add functionality for multiple user accounts within the same app, at the moment it only uses the last account used on the app. We have not yet had any use case for this though so I guess it will have to wait a bit._

Now we build or rebuild the `AuthHeader` hashtable, which will be used by `Invoke-RestRequest` to authorize actual Graph API calls.
- If `AuthHeader` doesn't exist, create it as an empty hashtable.
- We then check if the **Authorization**, **ExpiresOn** and **Tenant** exist in the hashtable, if not, we create them
  - The `Authorization` is needed when sending Graph API calls, it contains the **bearer token** retrieved from MSAL.
  - The `ExpiresOn` is the time when the token **expires**, this is used to determine if the token should be refreshed or not.
  - The `Tenant` key is used for determining if we should switch tenants

The reasoning for managing the AuthHeader this way is because before this version you could not add any other headers, so basically some Graph filtering methods would not work because I would always set the AuthHeader to contain the bearer token and ExpiresOn, all other keys would be removed.

## Finalizing, and Managed Identity

Then we only need to handle the AuthHeader variable so it can be reused by the function `Invoke-RestRequest`.

```powershell
if ($PassThru) {
    Write-Verbose 'PassThru switch present, returning AuthHeader'
    $script:AuthToken = $AuthHeader
    return $AuthHeader
} else {
    Write-Verbose 'Setting the authheader to the module scope AuthToken variable'
    $script:AuthToken = $AuthHeader
}
```

We always set the functions `AuthHeader` to the `$script:AuthToken` variable, by doing so we can retrieve this variable from within the same module, i.e. by `Invoke-RestRequest` automatically.

Also, we can't forget the Managed Identity code:

```powershell
Write-Verbose 'Using Managed Identity to get the token.'
try {
    $Credential = [Azure.Identity.DefaultAzureCredential]::new()

    $TokenRequestContext = [Azure.Core.TokenRequestContext]::new('https://graph.microsoft.com/.default')
    $Token = $Credential.GetToken($TokenRequestContext).Token

    $AuthHeader = @{
        'Authorization' = "Bearer $token"
        'ExpiresOn'     = (Get-Date).AddHours(1) # Tokens obtained from Managed Identity are valid for 1 hour
    }

    if ($PassThru) {
        $script:AuthToken = $AuthHeader
        return $AuthHeader
    } else {
        $script:AuthToken = $AuthHeader
    }
} catch {
    Write-Error "An error occurred while trying to get the token using Managed Identity: $_"
}
```

To be honest, the ManagedIdentity part of this function is more of a afterthought and a quick fix to get an Azure function up and running, I bashed my head around in the debugger and on the docs to try and get this all to work, when it finally started working I just patched some things up and left it as is. I haven't done any research on how it works behind the scenes, why it doesn't need most of the values that delegated access uses etc. The Azure functions that are running are working fine and that makes me happy, some day when it all breaks down will be a day to dive deeper into the inner workings of Managed Identity.

## Final form

This should then leave you with this final function:

```powershell
function Get-AuthToken {
    [CmdletBinding(DefaultParameterSetName = 'DelegatedAccess')]
    param(
        [Parameter(Mandatory = $false, ParameterSetName = 'DelegatedAccess')]
        [string]$TenantUri = $script:Tenant,

        [Parameter(ParameterSetName = 'DelegatedAccess')]
        [switch]$PassThru,

        [Parameter(ParameterSetName = 'DelegatedAccess')]
        [string]$TenantDomain = '.onmicrosoft.com',

        [Parameter(ParameterSetName = 'DelegatedAccess')]
        [string]$ClientId = '14d82eec-204b-4c2f-b7e8-296a70dab67e',

        [Parameter(ParameterSetName = 'DelegatedAccess')]
        [hashtable]$AuthHeader = $script:AuthToken,

        [Parameter(ParameterSetName = 'DelegatedAccess')]
        [Parameter(ParameterSetName = 'ManagedIdentity')]
        [string[]]$Scopes = @('.default'),

        [Parameter(ParameterSetName = 'DelegatedAccess')]
        [string]$RedirectUri = 'http://localhost',

        [Parameter(ParameterSetName = 'ManagedIdentity')]
        [switch]$Identity
    )
    # Checking for module dependencies
    Write-Verbose 'Checking for module dependencies.'
    if ($Identity -eq $false) {
        Install-DevOpsModule -Name 'Microsoft.Graph.Authentication'
    }

    # Setting the module scope Managed Identity variable for Invoke-RestRequest
    if ($Identity -eq $true) {
        $script:ManagedIdentitySwitch = $true
    } else {
        $script:ManagedIdentitySwitch = $false
    }

    # Checking for and adding assembly dependencies
    # Check if the microsoft.identity.client.dll is loaded, if not load it
    Write-Verbose 'Checking for assembly dependencies.'
    if (-not ([System.AppDomain]::CurrentDomain.GetAssemblies().FullName -match 'Microsoft.Identity.Client')) {
        Write-Verbose 'No Microsoft.Identity.Client assembly found. Loading assembly and dependencies from Microsoft.Graph.Authentication module.'
        Import-Module Microsoft.Graph.Authentication -Force
        $MSAuthModuleLocation = Get-Module Microsoft.Graph.Authentication | Select-Object -Expand ModuleBase
        If ($PSVersionTable.PSVersion.Major -le 5) {
            $MSAuthModuleDependencies = (Get-ChildItem -Path "$MSAuthModuleLocation\Dependencies" -File).FullName
            $MSAuthModuleDependencies += (Get-ChildItem -Path "$MSAuthModuleLocation\Dependencies\Desktop" -File).FullName
        } else {
            $MSAuthModuleDependencies = (Get-ChildItem -Path $MSAuthModuleLocation -Filter '*.dll' -Recurse).FullName
        }

        foreach ($Dependency in $MSAuthModuleDependencies) {
            try {
                Add-Type -Path $Dependency
            } catch {
                $FileName = Split-Path -Path $Dependency -Leaf
                Write-Verbose "Could not load $FileName"
            }
        }
    }

    switch ($PSCmdlet.ParameterSetName) {
        'ManagedIdentity' {
            Write-Verbose 'Using Managed Identity to get the token.'
            try {
                $Credential = [Azure.Identity.DefaultAzureCredential]::new()

                $TokenRequestContext = [Azure.Core.TokenRequestContext]::new('https://graph.microsoft.com/.default')
                $Token = $Credential.GetToken($TokenRequestContext).Token

                $AuthHeader = @{
                    'Authorization' = "Bearer $token"
                    'ExpiresOn'     = (Get-Date).AddHours(1) # Tokens obtained from Managed Identity are valid for 1 hour
                }

                if ($PassThru) {
                    $script:AuthToken = $AuthHeader
                    return $AuthHeader
                } else {
                    $script:AuthToken = $AuthHeader
                }
            } catch {
                Write-Error "An error occurred while trying to get the token using Managed Identity: $_"
            }
        }
        'DelegatedAccess' {
            $Token = $null
            $DateTime = (Get-Date).ToUniversalTime()

            if (-not ($TenantUri)) {
                $TenantUri = $(Write-Host 'Please specify tenant you wish to access:';Read-Host)
            }

            if (-not ($TenantUri -match 'onmicrosoft')) { $TenantUri = $TenantUri + $TenantDomain }

            $script:Tenant = $TenantUri
            $FriendlyTenant = $TenantUri -Split '\.' | Select-Object -First 1

            Write-Verbose "Checking if an existing MSAL Application exists for the [$FriendlyTenant] tenant"
            $Authority = "https://login.microsoftonline.com/$TenantUri"
            $SessionApp = Get-Variable -Name "App$FriendlyTenant" -Scope script -ValueOnly -ErrorAction SilentlyContinue
            if (-not $SessionApp) {
                Write-Verbose 'No MSAL Application for this tenant, creating one in the module scope'
                $SessionAppParams = @{
                    Name  = "App$FriendlyTenant"
                    Value = $([Microsoft.Identity.Client.PublicClientApplicationBuilder]::Create($ClientId).WithAuthority($Authority).WithRedirectUri($RedirectUri).Build())
                    Scope = 'Script'
                }
                New-Variable @SessionAppParams
                $SessionApp = Get-Variable -Name "App$FriendlyTenant" -Scope script -ValueOnly -ErrorAction SilentlyContinue
            }

            $ShouldRefreshMSALToken = (($AuthHeader.ExpiresOn -lt $DateTime.AddMinutes(5)) -or ($null -eq $AuthHeader) -or ($AuthHeader.Tenant -ne $TenantUri))
            if ($ShouldRefreshMSALToken) {
                Write-Verbose 'Gathering MSAL cached accounts, and trying to refresh the token'
                $Accounts = $SessionApp.GetAccountsAsync().Result
                $Token = $SessionApp.AcquireTokenSilent([string[]]$Scopes, $Accounts[0]).ExecuteAsync().Result

                if ($null -eq $Token) {
                    try {
                        Write-Verbose 'No cached accounts, acquiring token interactively'
                        $Token = $SessionApp.AcquireTokenInteractive([string[]]$Scopes).ExecuteAsync().Result
                    } catch {
                        Write-Error "An unexpected error occurred: $_"
                    }
                }

                if ($null -eq $AuthHeader) {
                    $AuthHeader = @{}
                }

                if ($AuthHeader.ContainsKey('Authorization')) {
                    $AuthHeader.Authorization = $Token.CreateAuthorizationHeader()
                } else {
                    $AuthHeader.Add('Authorization', $Token.CreateAuthorizationHeader())
                }

                if ($AuthHeader.ContainsKey('ExpiresOn')) {
                    $AuthHeader.ExpiresOn = $Token.ExpiresOn
                } else {
                    $AuthHeader.Add('ExpiresOn', $Token.ExpiresOn)
                }

                if ($AuthHeader.ContainsKey('Tenant')) {
                    $AuthHeader.Tenant = $TenantUri
                } else {
                    $AuthHeader.Add('Tenant', $TenantUri)
                }
            } else {
                Write-Verbose "Token is still valid for $(($AuthHeader.ExpiresOn - $DateTime).Minutes) minutes"
            }

            if ($PassThru) {
                Write-Verbose 'PassThru switch present, returning AuthHeader'
                $script:AuthToken = $AuthHeader
                return $AuthHeader
            } else {
                Write-Verbose 'Setting the authheader to the module scope AuthToken variable'
                $script:AuthToken = $AuthHeader
            }
        }
    }
}

```
# Example usage
```powershell
# This will prompt the user for a tenant
Get-AuthToken

# These will create a token for the specified tenant
Get-AuthToken -TenantUri 'contoso'
Get-AuthToken -TenantUri 'contoso.onmicrosoft.com'

# This will create a token for the specified tenant and return the AuthHeader object
$Token = Get-AuthToken -TenantUri 'contoso'

# This will create a token for the specified tenant on the specified azure app
Get-AuthToken -TenantUri 'contoso' -ClientID 'c30ba914-bfc8-48a2-ba85-ac0f658ae7f9'
```

# Conclusion

This concludes this blog post about Get-AuthToken, the function to make your life easier by handling authentication towards Graph with MSAL.
Next up will be about `Invoke-RestRequest`, this will tie together these two tightly knit functions, who work in perfect harmony to deliver the best Graph API experience!  
If you have any questions or feedback about the function, don't hesitate to reach out, I always try to strive to improve myself and my code. 
