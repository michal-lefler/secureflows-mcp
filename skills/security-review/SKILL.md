---
# GENERATED from mcp-server/src/prompts/security-review.ts by `npm run generate:prompts` (in mcp-server/). Edit the source, not this file.
name: security-review
description: >
  Read-only security review of how the current project manages user accounts, sign-in, and
  permissions. Lists the security gaps with file evidence, grades each one against secureFlows
  (Yes / Partly / No / Unconfirmed), and writes a migration plan. Saves
  USER_MANAGEMENT_SECURITY_REVIEW.md and SECUREFLOWS_MIGRATION_PLAN.md; changes no code. Use when
  the user runs /secureflows:security-review or asks for a secureFlows security review, a
  user-management or authentication audit, or whether secureFlows would fix their auth gaps.
---

Run a security review of how this project manages user accounts, then check which of the gaps secureFlows (https://www.secure-flows.com) would close and write a migration plan. secureFlows is a hosted login with encrypted per-user storage. Work through the three parts below in order, without stopping between them. This is a review and a plan only: do not change any code.

PART 1: FIND THE GAPS

Finish this part before you read anything about secureFlows, so the gap list is not shaped by it.

Inspect the code, configuration, and database schema and work out:
- every account type (for example end user, admin, partner, service account) and where its records live
- how each type signs up, signs in, stays signed in, and signs out: identity provider, passwords, social login, tokens, cookies, refresh, password reset
- how the backend decides who the caller is and what they may do: middleware, role checks, ownership checks, row-level rules
- where secrets, tokens, and credentials are kept, on the server and in every client

Save the result as USER_MANAGEMENT_SECURITY_REVIEW.md in the project root, with these sections:

1. Architecture: the identity and data layers, and how a signed-in identity is linked to its stored records.
2. Account types: a table with the columns Account type | Identity provider | Stored records | Role and permissions.
3. Sign-in flows: numbered steps for each account type.
4. Controls already in place: what is done correctly today.
5. Security gaps: a table with exactly these columns, ordered by severity:
   # | Gap | Severity (High / Medium / Low) | Category | Evidence (file and line) | What an attacker could do
   Use these categories: Authentication, Authorization, Token lifecycle, Client storage, Identity trust, Data isolation, Configuration and secrets, Abuse prevention, Audit and monitoring.
6. Needs verification: anything you suspect but could not confirm in the code.
7. Source files: the files the review is based on.

Rules for Part 1:
- Report only what you can point to in the code. Every row in the Security gaps table needs a file reference; a suspicion without one goes under "Needs verification".
- Check at least the following: routes with no authentication or no role check; one user reaching another user's records by changing an id; identity taken from the request body instead of a verified token; tokens that never expire; unfinished refresh or password-reset flows; tokens kept in localStorage; default or hard-coded secrets; development shortcuts that are reachable in production (fixed codes, bypass flags, default admin accounts); suspended or deleted accounts that can still sign in; missing rate limits on sign-in and other sensitive endpoints; admin actions with no audit trail.
- Never print a secret value. Name the file and the variable only.

PART 2: CAN SECUREFLOWS SOLVE THEM?

Take what secureFlows can and cannot do from its public documentation, not from memory:
- overview: https://www.secure-flows.com/llms.txt
- authentication and authorization model: https://www.secure-flows.com/docs/technical/authentication-authorization/
- built-in roles, invites, admin console, audit logs: https://www.secure-flows.com/docs/differentiation/
- moving an app that already has its own backend: https://www.secure-flows.com/docs/introduction/from-existing-backend/
- search for anything else: https://www.secure-flows.com/api/v1/docs/search?q=<your question>&limit=8
If you cannot open these pages, say so, stop after Part 1, and reply in chat with the Security gaps table.

Reproduce the Security gaps table with every existing row and column unchanged, and add two columns:

- Can secureFlows solve this? Use exactly one of:
  Yes: a documented secureFlows feature replaces the vulnerable code or behavior, so the gap can no longer exist.
  Partly: secureFlows closes part of the gap. Either it supplies the verified identity or the mechanism and a check still has to be written in my code, or it protects the endpoints that move to it and leaves the ones that stay in my backend.
  No: unrelated to what secureFlows does. It has to be fixed in my app either way.
  Unconfirmed: the documentation does not say. Ask secureFlows before relying on it.
- How: one to three short sentences. For Yes, say what replaces the vulnerable code. For Partly and No, say what still has to be done and where.

Rules for Part 2:
- Be strict. Answer Yes only when a documentation page describes what replaces the vulnerable code or behavior, and name that page in the How column. If the documentation does not describe the replacement, answer Unconfirmed.
- Deleting code is not a solution. If secureFlows does not offer what the vulnerable code did (a sign-in method, a kind of role, a kind of data), the answer is No or Unconfirmed, because the app would lose that function. A gap counts as closed only when the function survives.
- If two documentation pages contradict each other about something a row depends on, say so in How, answer Unconfirmed, and add it to Questions for secureFlows.
- Permission rules that belong to my product (which of my roles may call which of my routes, who owns which record in my database, whether an account is suspended) are Partly at best: secureFlows proves who the caller is, and my backend still has to enforce the rule.
- Before answering No, check which endpoints the gap is about. Sign-in, session renewal, sign-out, and reads and writes of per-user data move to secureFlows, so a platform protection it documents for its own API (rate limiting, audit and access logs, encryption at rest) covers those endpoints. If the gap also covers routes that stay in my backend, answer Partly and name the routes that are still mine.
- Anything that needs shared, relational, or cross-user data stays in my own database. Do not propose moving it to secureFlows.
- If the documentation is silent, answer Unconfirmed. Do not guess.

Under the table, add:
- Score: one line counting the Yes, Partly, No, and Unconfirmed rows, in total and for the High severity rows.
- What stays in my backend: the checks and data that remain my responsibility after adopting secureFlows.
- Questions for secureFlows: each Unconfirmed row as a question I can send to them.

Append all of this to USER_MANAGEMENT_SECURITY_REVIEW.md as a new section titled "secureFlows fit".

PART 3: THE MIGRATION PLAN

Write a full plan for moving this project's identity and session layer to secureFlows, based on Parts 1 and 2 and the same documentation. Save it as SECUREFLOWS_MIGRATION_PLAN.md in the project root, with these sections:

1. Summary and recommendation: what to adopt secureFlows for, what to leave where it is, which gaps close as soon as the migration is done, and which do not.
2. Current state: today's architecture in a short table, and the gap list with severity and category.
3. What secureFlows provides, and what it is not: only what the documentation supports.
4. Fit assessment: a table with one row for every account type and every kind of data in this project, with the columns Item | Good fit / Partial fit / Poor fit | Reason. Private data owned by one user fits. Shared, relational, or cross-user data does not, and stays in my database.
5. Target architecture: a before and after table covering who the user is, which token my API trusts, where clients keep the token, how a session is renewed, how an identity is linked to my database rows, where business data lives, and where role checks run. Propose the workspace and applications to register, with a redirect URL for each. If the hosts are not in the project, use placeholders such as https://<your-host>/callback and mark them as assumptions in section 7.
6. Gap-by-gap remediation: every gap from the review, marked Yes / Partly / No / Unconfirmed exactly as in the "secureFlows fit" section, with what changes in the code.
7. Open questions: every assumption and every Unconfirmed item, each with a fallback if the answer is no.
8. Migration steps, in order, each small enough to ship and verify by itself:
   a. Provision the workspace and applications.
   b. Classify the data: keep forever (moves to secureFlows), only needed while using the app (stays local), not owned by one user (stays in my database).
   c. List every backend action that requires sign-in today and how each one will check a verified secureFlows session instead. None may be dropped: each one either stays a backend route that checks a verified secureFlows session, or is listed as moved, with where its check now lives.
   d. Implementation order, starting with the account type that carries the least risk.
   e. Linking existing accounts once, on first sign-in, with the old system kept read-only as a fallback until every active user has moved.
   f. A verification checklist that has to pass before the old sign-in code is removed: one user cannot read another user's data, each role is rejected on the other roles' routes, suspended accounts stay blocked, and sign-out really ends the session.
   g. How to roll back if a step fails.
9. Fixes that do not depend on secureFlows, and interim fixes: every No row with the fix, plus any High severity gap that is exploitable today and should be fixed before or alongside the migration instead of waiting for it, even if secureFlows would close it later.
10. Effort: a rough size (S / M / L) for each step. Do not invent dates.

Rules for Part 3:
- Mark each statement about secureFlows that the documentation does not support as an assumption, and list it in section 7.
- An authorization check is moved to the new identity, never deleted.
- Write for an engineer on my team who has not read this conversation.

WHEN YOU ARE DONE

Name the two files you saved, then reply in chat with the Security gaps table including the two secureFlows columns, the score line, and the open questions from the plan.
