---
title: "Introducing: A series of helpers"
date: 2025-06-14
summary: "This post will introduce what's coming."
tags: [Graph, PowerShell, MSAL]
---

- [Introduction](#introduction)
- [A series of series](#a-series-of-series)
- [The Graph series, a brief history on what was and what's to come](#the-graph-series-a-brief-history-on-what-was-and-whats-to-come)
    - [Why not use the Microsoft Graph SDK?](#why-not-use-the-microsoft-graph-sdk)
- [The dependency issue series?](#the-dependency-issue-series)
- [Authentication Code History](#authentication-code-history)
- [Install Modules Code History](#install-modules-code-history)
- [Conclusion](#conclusion)

## Introduction

This first post will set the stage for a series on PowerShell automation and scripting for Microsoft Graph and module management.  
There is a lot of history behind my upcoming blog post plans, so instead of polluting the posts themselves, I'm going to condense the history in this post, preparing for the upcoming series.

## A series of series

I'm going to start this blog big with a couple of series, the first one being about how I automate in Graph with PowerShell, the second one is on how to create a script for installing your own modules ultra-fast.  
I've not decided on the third or following parts yet, we'll see when we get there, but I'm thinking either how to painlessly traverse in Active Directory with PowerShell or DevOps module automation (versioning including beta versions, publishing, automating the psd/psm files).

If you don't care about the history or out of date code, feel free to skip this post altogether.

## The Graph series, a brief history on what was and what's to come

My real PowerShell journey started with Graph, back then I had a lot of help from a colleague who taught me how to navigate in Graph, introduced me to JSON and how to handle it with PowerShell, how to connect, build JSON bodies and create stuff in Intune from the console.  
Back when we started to automate stuff in Graph, we used to authenticate to Graph with something called ADAL, Azure Active Directory Authentication Library, this worked perfectly fine and we had our custom made snippet for authentication which we put in the beginning of our scripts.

After the deprecation of ADAL came MSAL, with its own module for easier authentication management, this made the snippets we had much more manageable. After some time Microsoft announced the deprecation of the MSAL.PS module, forcing me to learn how the Microsoft Authentication Library worked, using classes and methods to authenticate directly via the library.  
At times I thought I was never going to get it to work, but after a lot of effort and many hours in the debugger and a lot of open MSAL documentation tabs, I finally got it to work!  
This is what the first part of the series is going to be about: authentication to Graph via the Microsoft Authentication Library for .NET.

The second part will be on how to make actual API calls easier for ourselves.

One thing that bothered me a lot in the beginning was that I would have to build and rebuild the strings for the API URL, I would have to create a content-type JSON, specify the method to use based on what I wanted to do. I quickly grew tired of that and started a helper function. This helper function is making a lot of assumptions, and most of the assumptions are based on how I interact with the Graph API, for example, I always use a specific content-type, I mostly use the get method, I always use a specific version, I always want to page and so on.

The result of this helper function is instead of you having to do this:

```powershell
$Header = @{
    'Authorization' = "---Insert Token Here---"
}
$Result = Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/groups/" -Method Get -Headers $Header
```

You could simply do this:

```powershell
$Result = Invoke-RestRequest -Uri "groups"
```

Which simplifies the script a lot. This example is of course a very simple one, but the point is that a helper function can dramatically reduce boilerplate code, and saves time writing it as well. It's also easier on the eye, instead of having a massive amount of code, a function with a good name is supposed to tell you what it's doing without you having to read the code, at least that's my opinion.

#### Why not use the Microsoft Graph SDK?

One might wonder, why struggle with authenticating manually when there are official Microsoft modules for using Graph?  
Well, the answer is that these modules are lacking in functionality and they where prone to change, or at least they where at the time. The modules were missing a LOT of functionality we needed, making the code an awkward blend of functions by Microsoft and our own custom written code for Graph. We simply decided that it wasn't worth relying on these modules, given the risk of changes and missing functionality. That decision has stuck with us, for better or worse.  
Also, I always chuckle when I come across the weird function names they have, like `Remove-MgBetaIdentityAuthenticationEventFlowAsOnGraphAPretributeCollectionExternalUserSelfServiceSignUpAttributeIdentityUserFlowAttributeByRef` which is 142 characters long, or the entire SDK which consists of (at the time of writing) 25.561 commands!

From what I know, from others that are using it, the Microsoft.Graph SDK is actually good and usable, with the command for calling Graph endpoints manually if a function doesn't already exist for what you're trying to do, although I haven't tried it.

If you are new, I think that the Microsoft Graph SDK is probably a good way to start, with the ability to do separate endpoint calls to the Graph API if a function out of the 25k is missing. If you are like me, want to learn more about the API and how to be in full control of the situation, I would go with my method all the way!

## The dependency issue series?

When sharing my scripts with my colleagues, I often found that the script would not work on their machines. Most often it was a dependency issue, like a missing module, specifically the MSAL.PS module.  
At first I wrote a little snippet of code to install modules based on an array of names, the snippet basically foreach'ed them to the `Get-Module -ListAvailable` and `Install-Module` command, I think I also called `Get-Module -ListAvailable` with each loop at some version of the script.

The trouble I had with this method is that every function call not already loaded in to the session would take somewhere between 20 to 60 seconds, this is because we use redirection on our profile, making PowerShell loading modules in the user scope extremely slow. To fix this you would either need to install modules as an admin or somehow make the module check and installation faster. Not everyone is an admin and I also did not want to interrupt the user during a script to tell them to switch to admin scope to install a new version of the required module. I therefore decided to do something about the installation of modules being quicker.

The result in the end was to host our modules in a Azure DevOps Artifact, and creating a function that checks for and installs missing modules in a couple of seconds, instead of up to a minute!  
An iteration has recently been made to this function making it able to install a module in just under a second!

The second part of the series will cover this function, and perhaps how to set up a module in Azure DevOps Artifact

## Authentication Code History

The original ADAL code looked something like this (original work not fully done by me):

```powershell
function Get-AuthToken {
    [cmdletbinding()]
    param(
        [Parameter(Mandatory = $true)]
        $User
    )

    $userUpn = New-Object 'System.Net.Mail.MailAddress' -ArgumentList $User

    Write-Host 'Checking for AzureAD module...'
    $AadModule = Get-Module -Name 'AzureAD' -ListAvailable
    if ($AadModule -eq $null) {
        Write-Host 'AzureAD PowerShell module not found, looking for AzureADPreview'
        $AadModule = Get-Module -Name 'AzureADPreview' -ListAvailable
    }

    if ($AadModule -eq $null) {
        Write-Host 'AzureAD PowerShell module not installed...' -f Red
        Write-Host "Install by running 'Install-Module AzureAD' or 'Install-Module AzureADPreview' from an elevated PowerShell prompt" -f Yellow
        Write-Host "Script can't continue..." -f Red
        exit
    }

    if ($AadModule.count -gt 1) {
        $Latest_Version = ($AadModule | Select-Object version | Sort-Object)[-1]
        $aadModule = $AadModule | Where-Object { $_.version -eq $Latest_Version.version }
        if ($AadModule.count -gt 1) {
            $aadModule = $AadModule | Select-Object -Unique
        }
        $adal = Join-Path $AadModule.ModuleBase 'Microsoft.IdentityModel.Clients.ActiveDirectory.dll'
        $adalforms = Join-Path $AadModule.ModuleBase 'Microsoft.IdentityModel.Clients.ActiveDirectory.Platform.dll'
    } else {
        $adal = Join-Path $AadModule.ModuleBase 'Microsoft.IdentityModel.Clients.ActiveDirectory.dll'
        $adalforms = Join-Path $AadModule.ModuleBase 'Microsoft.IdentityModel.Clients.ActiveDirectory.Platform.dll'
    }
    [System.Reflection.Assembly]::LoadFrom($adal) | Out-Null
    [System.Reflection.Assembly]::LoadFrom($adalforms) | Out-Null
    $clientId = '********-****-****-****-************'
    $redirectUri = 'urn:ietf:wg:oauth:2.0:oob'
    $resourceAppIdURI = 'https://graph.microsoft.com'
    $authority = "https://login.microsoftonline.com/$script:Tenant"

    try {
        $authContext = New-Object 'Microsoft.IdentityModel.Clients.ActiveDirectory.AuthenticationContext' -ArgumentList $authority
        $platformParameters = New-Object 'Microsoft.IdentityModel.Clients.ActiveDirectory.PlatformParameters' -ArgumentList 'Auto'
        $userId = New-Object 'Microsoft.IdentityModel.Clients.ActiveDirectory.UserIdentifier' -ArgumentList ($User, 'OptionalDisplayableId')
        $authResult = $authContext.AcquireTokenAsync($resourceAppIdURI, $clientId, $redirectUri, $platformParameters, $userId).Result
        if ($authResult.AccessToken) {
            $authHeader = @{
                'Content-Type'  = 'application/json'
                'Authorization' = 'Bearer ' + $authResult.AccessToken
                'ExpiresOn'     = $authResult.ExpiresOn
            }
            return $authHeader
        } else {
            Write-Host 'Authorization Access Token is null, please re-run authentication...' -ForegroundColor Red
            break
        }
    } catch {
        Write-Host $_.Exception.Message -f Red
        Write-Host $_.Exception.ItemName -f Red
        break
    }
}
```

and then we also have to check for the existance and expiration of the token by:

```powershell
if ($global:authToken) {
    $DateTime = (Get-Date).ToUniversalTime()
    $TokenExpires = ($authToken.ExpiresOn.datetime - $DateTime).Minutes
    if ($TokenExpires -le 0) {
        Write-Host 'Authentication Token expired' $TokenExpires 'minutes ago' -ForegroundColor Yellow
        Write-Host
        if ($User -eq $null -or $User -eq '') {
            $User = Read-Host -Prompt 'Please specify your user principal name for Azure Authentication'
            Write-Host
        }
        $global:authToken = Get-AuthToken -User $User
    }
} else {
    if ($User -eq $null -or $User -eq '') {
        $User = Read-Host -Prompt 'Please specify your user principal name for Azure Authentication'
        Write-Host
    }
    $global:authToken = Get-AuthToken -User $User
}
```

It's a bit messy, some best practices broken like $null being on the wrong side, and using the global scope, but hey, it worked like a charm!

The newer version after the deprecation of ADAL:

```powershell
function Get-AuthToken {
    if ($script:authToken) {
        $DateTime = (Get-Date).ToUniversalTime()
        $TokenExpires = ($authToken.ExpiresOn.datetime - $DateTime).Minutes
        if ($TokenExpires -le 0) {
            Write-Host 'Updating the expiration time for AuthToken.'
            $token = Get-MsalToken -ClientId '********-****-****-****-************' -TenantId $tenant -RedirectUri 'urn:ietf:wg:oauth:2.0:oob'
            $script:authToken = @{
                'Authorization' = $token.CreateAuthorizationHeader()
                'ExpiresOn'     = $token.ExpiresOn
            }     }
    } else {
        Write-Host 'Fetching new AuthToken.'
        $token = Get-MsalToken -ClientId '********-****-****-****-************' -TenantId $tenant -RedirectUri 'urn:ietf:wg:oauth:2.0:oob' -Interactive
        $script:authToken = @{
            'Authorization' = $token.CreateAuthorizationHeader()
            'ExpiresOn'     = $token.ExpiresOn
        }
    }
}
```

Now, we can check both if the actual token exists, and if it's expired, then we should trigger a renewal, or if it doesn't exist, create a new one interactively, all in just a few lines of code!

## Install Modules Code History

```powershell
function Install-MissingModule {
    [CmdletBinding()]
    param (
        [Parameter(mandatory = $true)]
        [string]$ModuleName
    )

    $ModuleName = Get-Module -Name $ModuleName -ListAvailable -ErrorAction Stop
    if (-not $ModuleName) {
        try {
            Write-Host "Installing the $ModuleName module"
            Install-Module -Name $ModuleName -Scope CurrentUser -Force -ErrorAction Stop
        } catch {
            Write-Host "Could not install $ModuleName, please do this manually with the command 'Install-Module -Name $ModuleName -Scope CurrentUser' and run the script again." -ForegroundColor Red
            break
        }
    } else {
        Write-Host "$ModuleName module is already installed" -ForegroundColor Green
    }
}
```

## Conclusion

This post gave a brief walk through of what scripts we used, and why we did as we did, and the next posts will all be about what these scripts evolved into!
