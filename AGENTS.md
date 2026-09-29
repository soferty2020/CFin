\# CFin Project Instructions



\## Project



CFin is an internal web application for company cash-flow management, planning, forecasting, balances, payment calendar, categories, counterparties, accounts, and reporting.



The local repository root is this Git project.

`server-snapshot` is a local snapshot of the deployed application and may be stale.

Do not assume that local snapshot behavior equals current production behavior.



\## Context strategy



Use project context in this order whenever practical:



1\. Memorix

&#x20;  - Use Memorix first for established business rules, architectural decisions, known issues, constraints, and previously confirmed project facts.

&#x20;  - Prefer `memorix\_search` before rediscovering already-known facts from files.

&#x20;  - Use `memorix\_detail` only when the full stored record is needed.

&#x20;  - Do not treat Memorix as source code storage.



2\. CodeGraph

&#x20;  - Use CodeGraph first for source-code structure, navigation, dependencies, call chains, routes, functions, and relationships.

&#x20;  - Prefer CodeGraph over broad grep/find/read exploration.

&#x20;  - Do not repeatedly crawl files when CodeGraph already provides sufficient context.



3\. Direct file reads

&#x20;  - Read source files when exact implementation details, exact SQL, exact configuration, or surrounding code are necessary.

&#x20;  - Keep reads narrow and targeted.

&#x20;  - Avoid dumping large files into context unnecessarily.



\## Memory policy



Store in Memorix only durable project knowledge such as:



\- confirmed business rules;

\- architectural decisions and their rationale;

\- confirmed project facts;

\- known issues and gotchas;

\- unresolved questions that matter across sessions.



Do not store:



\- source code;

\- large file contents;

\- transient debugging output;

\- terminal logs;

\- conversation summaries;

\- speculative conclusions presented as facts.



When a fact may have changed, verify it before treating it as current.



\## Source-of-truth discipline



Distinguish clearly between:



\- business requirements;

\- Memorix project knowledge;

\- local `server-snapshot`;

\- current production behavior.



Production behavior must not be inferred solely from the local snapshot.



If local implementation conflicts with a business rule, report the discrepancy before changing code.



\## CFin business invariants



Preserve these rules unless explicitly superseded by confirmed requirements:



\- Actual operations affect real balances.

\- Planned operations affect forecast only.

\- Executing a planned operation must not double-count it as both planned and actual.

\- Transfers between the company's own accounts are not company income or expense.

\- Forecasts must support both per-account and company-wide views.

\- Negative forecast balances must be clearly flagged.



\## Change discipline



Before modifying code:



1\. identify the relevant business rule;

2\. check Memorix for existing decisions or known issues;

3\. use CodeGraph to identify the affected code path;

4\. read only the necessary implementation details;

5\. explain any ambiguity or conflict before making a risky change.



Do not change production-related behavior based only on an unverified assumption.



\## Efficiency



Prefer small, evidence-driven tool calls.

Avoid repeated searches for information already available in Memorix or CodeGraph.

Do not perform broad repository audits unless explicitly requested.

