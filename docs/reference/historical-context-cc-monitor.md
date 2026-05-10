# Historical Context — `cc-monitor`

> **Status:** Out of scope for `agent-host-cc` v1 (decision D-3 / CONFIRMED-3 in the refined request).
> **Purpose:** Pointer-only. Nothing here is consumed at build time or runtime.

`cc-monitor` is a sibling tool from the source repository at:

`/Users/giorgosmarinos/aiwork/open-webui-phase1/cc-monitor/`

It is a separate monitoring application built around the same Claude Code agent ecosystem as the original `agent-host` service — broadly, an Electron / CLI dashboard that uses `dockerode` to inspect running containers and surface agent-related telemetry.

`cc-monitor` is **not** a component of `agent-host-cc`:

- It is **not** migrated. No code from `cc-monitor` exists in this project.
- It is **not** a build dependency. `npm install` against `agent-host-cc` does not pull anything from `cc-monitor`.
- It is **not** a runtime dependency. The `agent-host-cc` container does not communicate with `cc-monitor` and does not require it to be running.

If you want to use the two together, run them as **separate containers** (or separate processes) with no shared mount points, no shared network, and no shared configuration. They are independent.

This file exists only so a future maintainer browsing the source-extraction history can answer "what was that other thing in the source repo, and why isn't it here?" — the answer is "out of scope for v1; deploy it separately if you want it."
