# Learning GCP CI/CD: A Beginner's Guide

This document is designed to help you understand the concepts and technologies used in our Google Cloud Platform (GCP) deployment pipeline. If you've never used GCP, Docker, or GitHub Actions before, this is the perfect place to start.

---

## 1. What is CI/CD?

**CI/CD** stands for **Continuous Integration and Continuous Deployment**.
- **Continuous Integration (CI)**: Every time you push code to GitHub, an automated script (GitHub Actions) runs to make sure your code isn't broken. It does this by running your automated tests.
- **Continuous Deployment (CD)**: If the tests pass, the pipeline automatically takes your new code and puts it on your live server (GCP) so users can see the changes.

Instead of manually logging into a server, copying files, and restarting services, the pipeline does it all for you automatically and safely.

---

## 2. The Core Technologies

Our pipeline uses three main technologies:

### A. Docker (Containerization)
Think of a **Docker Container** like a shipping container. In the past, if you wanted to move code from your laptop to a server, you had to make sure the server had the exact right version of Node.js, the right operating system, and all the exact same files. 
With Docker, we put your app, Node.js, and all the files it needs into a single "box" (a container image). That box will run exactly the same way on your laptop as it does on Google's servers.

- **Dockerfile**: This is a text file that acts as a recipe. It tells Docker how to build your box (e.g., "Start with Node.js, copy my files over, and run `npm run build`").

### B. Google Artifact Registry
If a Docker Image is a shipping container, the **Artifact Registry** is the shipping yard. It's a secure storage space on Google Cloud where we upload and store our Docker boxes. When it's time to deploy, Google Cloud Run grabs the box from this registry.

### C. Google Cloud Run
This is where your code actually lives and runs on the internet.
Cloud Run is a **Serverless** platform. This means you don't have to manage or maintain a virtual machine. You just give Cloud Run your Docker container, and it automatically handles everything else:
- **Scaling**: If no one is using your app, it scales down to zero (saving you money). If a million people visit suddenly, it spins up thousands of containers instantly.
- **Versioning & Rollbacks**: Every time you deploy a new container, Cloud Run creates a new "Revision." If the new version is broken, you can click a button in the GCP dashboard to instantly send all traffic back to the old, working revision.

---

## 3. How do GitHub and GCP talk securely? (WIF)

Normally, if you want GitHub to deploy to GCP, you have to generate a secret password (a JSON key file) in GCP and save it in GitHub. This is dangerous because if someone hacks your GitHub, they get permanent access to your GCP account.

**Workload Identity Federation (WIF)** is the modern, secure way to solve this.
Instead of using a password, WIF acts like a VIP bouncer:
1. GCP says: "I trust GitHub. If a request comes from the `srinjoy-2005/wacrm` repository, I will let it in."
2. GitHub Actions temporarily asks GCP for access.
3. GCP checks the ID, sees it's really the correct GitHub repo, and issues a temporary key that expires in 1 hour.

No passwords are ever stored, making it incredibly secure.

---

## 4. The Flow of our Pipeline

Here is exactly what happens when you push to the `main` branch:

1. **Trigger**: GitHub sees you pushed code to `main`.
2. **Test**: GitHub Actions spins up a temporary computer, installs your dependencies, and runs `npm test`. 
3. **Build**: If tests pass, it uses the `Dockerfile` to build a new container.
4. **Push**: It uses WIF to securely upload the container to GCP Artifact Registry.
5. **Approval**: The pipeline stops and waits. It sends you a notification. You must go to the GitHub website and click "Approve" (this is configured via GitHub Environments).
6. **Deploy**: Once approved, GitHub tells Google Cloud Run to start serving the new container.
7. **Verify**: The pipeline hits your new Cloud Run URL to make sure it responds successfully.

If anything goes wrong, you just go to the Cloud Run dashboard and click "Rollback" to the previous revision!
