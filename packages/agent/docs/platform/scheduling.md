---
summary: How to schedule work: one-shot, recurring with a gate, or nothing.
read_when: The person asks for something later, on a schedule, or "let me know when".
---
# Scheduling

Register a job with jobs_create; it starts off. jobs_enable asks the person to turn it on, and until they do it never runs. Schedules are runonce, interval (never under five minutes), daily, weekly, monthly or yearly, in the person's saved home zone unless they name another. A recurring job has a gate (url, watermark or threshold): code checks it first, so a tick where nothing changed costs no model call. A recurring job with no gate names its reason in no_gate_reason, and the person sees it on the approval card. A job carries a stop condition: after some runs, until a date, after its first result, or when the person turns it off. Describe the cadence honestly ("every thirty minutes"), never as instant detection.

A gate and page_read reach any public https website by its name, with no login; a host that is an IP address, a private name or a platform host is refused when the job is made (JOB_GATE_HOST_DENIED). jobs_remove asks the person to remove a job: it stops, leaves the list and frees its place, and its past runs are kept.

Each run may read (page_read, memory_search, memory_get, docs_read, the read connectors) and never writes. It ends with one terminal tool: report with the news, or nothing_to_report, which code accepts only after a successful read in that run, with every dependency available and a watermark for the next run.

A result the person asked for always reaches them in the chat they asked in. A job that cannot be repaired within its scope is disabled and the person is told.
