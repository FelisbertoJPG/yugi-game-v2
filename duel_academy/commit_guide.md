# AI Commit Guide

Whenever instructed to commit changes to this repository, you MUST follow these steps precisely to maintain consistency and safety.

## 1. Context Analysis
Before doing anything, review the last 10 commits of the repository (e.g., using `git log -n 10`). This establishes the context, language (prioritize English), and exact formatting style previously used in the project.

## 2. Commit Structuring
Craft the commit message based on the analysis from Step 1. You must strictly adhere to the **Conventional Commits** format. Always use one of the following prefixes followed by a colon and a brief description:
- `feat:` (New feature)
- `fix:` (Bug fix)
- `refactor:` (Code restructuring without changing behavior)
- `chore:` (Routine tasks, dependency updates, tooling)
- `docs:` (Documentation updates)

## 3. Diff Analysis & Safety Check
Analyze the differences between the current branch and its remote counterpart on `origin` (e.g., `git status`, `git diff`, `git diff origin/main`). Ensure that:
- No important changes were lost or overwritten during the local work.
- All intended modifications are properly staged for the commit.

## 4. Initialization Scenario
If the repository has no commit history or only an initial `init` commit:
- Default to the Conventional Commits structure outlined in Step 2.
- **Prioritize English** for the commit messages to maintain a professional baseline.

## 5. Push
Once the commit is finalized and you are confident the state is safe, execute a `git push` to synchronize the changes with the remote repository.
