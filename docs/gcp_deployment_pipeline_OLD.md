# GCP Deployment Pipeline Configuration Guide

This document outlines how to set up the infrastructure on Google Cloud Platform and GitHub to support our continuous deployment pipeline for `wacrm`.

## Prerequisites

- GCP Project ID: `testing-wacrm-for-abha`
- Location/Region: `asia-south1`
- Google Cloud CLI (`gcloud`) installed locally, or use the [Google Cloud Shell](https://shell.cloud.google.com/).

## 1. Enable Required GCP APIs

Run these commands in your terminal or Cloud Shell to enable the necessary Google Cloud services:

```bash
gcloud config set project testing-wacrm-for-abha

gcloud services enable \
  iamcredentials.googleapis.com \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com
```

## 2. Create an Artifact Registry Repository

We need a place to store our Docker images before deploying them to Cloud Run.

```bash
gcloud artifacts repositories create cloud-run-source-deploy \
  --repository-format=docker \
  --location=asia-south1 \
  --description="Docker repository for wacrm"
```

## 3. Set Up Workload Identity Federation (WIF)

WIF allows GitHub Actions to securely authenticate to Google Cloud without using long-lived Service Account JSON keys.

### 3.1 Create a Service Account
```bash
gcloud iam service-accounts create github-actions-sa \
  --display-name="GitHub Actions Deployment Service Account"

export SERVICE_ACCOUNT=github-actions-sa@testing-wacrm-for-abha.iam.gserviceaccount.com
```

### 3.2 Grant Permissions to the Service Account
This service account needs permissions to push to Artifact Registry and deploy to Cloud Run.

```bash
# Allow pushing to Artifact Registry
gcloud projects add-iam-policy-binding testing-wacrm-for-abha \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/artifactregistry.writer"

# Allow deploying to Cloud Run
gcloud projects add-iam-policy-binding testing-wacrm-for-abha \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/run.admin"

# Allow acting as itself (required for Cloud Run to start the service)
gcloud projects add-iam-policy-binding testing-wacrm-for-abha \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/iam.serviceAccountUser"
```

### 3.3 Create the Workload Identity Pool and Provider

```bash
# Create a pool named "github"
gcloud iam workload-identity-pools create github \
  --location="global" \
  --display-name="GitHub Actions Pool"

# Get the Project Number (not ID)
export PROJECT_NUMBER=$(gcloud projects describe testing-wacrm-for-abha --format="value(projectNumber)")
echo $PROJECT_NUMBER # Save this number for later

# Create a provider for GitHub inside the pool
# NOTE: Replace 'srinjoy-2005' with your actual GitHub username or organization
gcloud iam workload-identity-pools providers create-oidc my-repo \
  --location="global" \
  --workload-identity-pool="github" \
  --display-name="My GitHub Repo Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner == 'srinjoy-2005'" \
  --issuer-uri="https://token.actions.githubusercontent.com"
```

### 3.4 Bind the Service Account to your GitHub Repository

Replace `YOUR_GITHUB_USERNAME/wacrm` with your actual GitHub repo (e.g. `srinjoy-2005/wacrm`):

```bash
export REPO="srinjoy-2005/wacrm" # UPDATE THIS

gcloud iam service-accounts add-iam-policy-binding "${SERVICE_ACCOUNT}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${REPO}"
```

## 4. Update the GitHub Workflow

In `.github/workflows/deploy-gcp.yml`, update the `WIF_PROVIDER` and `WIF_SERVICE_ACCOUNT` environment variables using the `PROJECT_NUMBER` and `SERVICE_ACCOUNT` from the steps above:

```yaml
env:
  PROJECT_ID: 'testing-wacrm-for-abha'
  REGION: 'asia-south1'
  SERVICE_NAME: 'wacrm-service'
  WIF_PROVIDER: 'projects/YOUR_PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/my-repo'
  WIF_SERVICE_ACCOUNT: 'github-actions-sa@testing-wacrm-for-abha.iam.gserviceaccount.com'
```

## 5. Configure GitHub Environment (Manual Approval)

To make GitHub pause the workflow and ask for your permission before deploying to GCP:

1. Go to your GitHub repository -> **Settings**
2. Click on **Environments** on the left sidebar.
3. Click **New environment** and name it `production`.
4. Check **Required reviewers**.
5. Add yourself (or your team) as a reviewer and save the protection rule.

## 6. How to Rollback

Google Cloud Run automatically manages revisions. If a new version breaks:

### Via Google Cloud Console:
1. Go to Cloud Run in the GCP Console.
2. Click on your service (`wacrm-service`).
3. Click the **Revisions** tab.
4. Click **Manage Traffic** and allocate 100% traffic to the older, working revision.

### Via gcloud CLI:
```bash
# List revisions to find the name of the previous one
gcloud run revisions list --service wacrm-service --region asia-south1

# Send 100% traffic to that revision
gcloud run services update-traffic wacrm-service --region asia-south1 --to-revisions=REVISION_NAME=100
```
