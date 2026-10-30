# Examples for Workflows and Schedules Time Skipping

Simplified examples prepared based on how CBA uses schedules.

- **Workflow 1 — `workflowWithActivityAndTimer`:** a one-hour user timer → Activity →
  one-hour user timer. It demonstrates time skipping for a Workflow that needs no
  additional Signals or Updates. The Activity still executes on a Worker in
  wall-clock time; the Workflow timers can be skipped.
- **Workflow 2 — `workflowWaitOnSignalAndTimer`:** a one-hour user timer → Activity
  creates an approval request → wait for user approval or a 24-hour timeout →
  Activity records approval → final one-hour timer. It demonstrates how to use
  time skipping with Workflows that need external interactions such as Signals
  or Updates. This demo uses a `proceed` Signal: fast-forward to the approval
  wait, send the Signal, then resume skipping. Without approval, unrestricted
  skipping reaches the business timeout and the Workflow fails.
- **Schedule examples:** to demonstrate two overlap policies, the first Schedule
  runs Workflow 1 with **Skip**, and the second runs Workflow 2 with **AllowAll**.

## Setup

Use three terminals. Keep the server and Worker running throughout the walkthrough.
The TypeScript Worker requires Node.js **22.13 or later** for built-in SQLite support.

### Step 1 — Terminal 1: build the CLI and start the local server

Stop any existing dev server on these ports before starting this one.
Build the CLI from the time-skipping source branch and start its embedded dev server:

```bash
cd ~/projects/cli
go build -o /tmp/temporal-vts ./cmd/temporal

/tmp/temporal-vts server start-dev \
  --namespace timeskipping-test \
  --enable-time-skipping
```

Open **http://localhost:8233**, select **timeskipping-test**, and leave the server
running. Its address is `127.0.0.1:7233`.

Schedule time skipping requires CHASM Schedules. `--enable-time-skipping` also
enables CHASM creation for new Schedules.

### Step 2 — Terminal 2: start the TypeScript Worker

```bash
cd ~/projects/demo-timeskipping-cba
npm ci
npm run worker
```

Wait for the Worker to report that it is running. It registers both Workflows
and their Activities on `timeskipping-cba`, in Namespace `timeskipping-test`.
This is a different task queue from the Go example's `vts-test-queue`.
Activities write to `data/approvals.sqlite`. Keep the Worker running; time
skipping still needs a Worker to execute Workflow and Activity tasks.

If a command later waits without progress, check this terminal first. A Worker
must be connected to the same server, Namespace, and task queue as the Workflow.

### Step 3 — Terminal 3: run the demo commands

```bash
cd ~/projects/demo-timeskipping-cba
```

Run the remaining commands in Terminal 3. All CLI commands use the feature
build at `/tmp/temporal-vts`. `describe` checks are optional; you can inspect the
same state in the Web UI. Use fresh Workflow and Schedule IDs when repeating tests.

## Part 1: Workflow

### 1A. Activity-and-timers Workflow: start, enable, poll, and describe

Run these commands in Terminal 3. The Workflow has a one-hour timer, an Activity,
and a second one-hour timer.

**Step 1 — Start without time skipping.**

```bash
/tmp/temporal-vts workflow start \
  --namespace timeskipping-test \
  --workflow-id cba-direct-activity \
  --type workflowWithActivityAndTimer \
  --task-queue timeskipping-cba
```

In the Web UI, expect **Running**, with the first timer pending.

**Step 2 — Fast-forward 90 minutes.**

```bash
/tmp/temporal-vts workflow time-skipping enable \
  --namespace timeskipping-test \
  --workflow-id cba-direct-activity \
  --fast-forward-duration 90m \
  --fast-forward-id cba-direct-activity-90m
```

**Step 3 — Poll that fast-forward.**

```bash
/tmp/temporal-vts workflow time-skipping poll \
  --namespace timeskipping-test \
  --workflow-id cba-direct-activity \
  --fast-forward-id cba-direct-activity-90m \
  --command-timeout 30s
```

Expected: `completed`. This means the fast-forward completed; the Workflow
itself is still running. If the command times out, check that the Worker is
running and poll again. Add `--output json` for `{"completed":true}`.

**Step 4 — Optional: inspect the Workflow with describe or the Web UI.**

```bash
# Optional: inspect status (or use the Web UI).
/tmp/temporal-vts workflow describe \
  --namespace timeskipping-test \
  --workflow-id cba-direct-activity \
  --time-format iso
```

Expect **Running**. In `Time Skipping`, `FastForwardInfo.HasCompleted` is true
and `EffectiveEnabled` is false. The first timer fired and the Activity completed;
the second timer has roughly 30 minutes remaining. Virtual time has advanced
90 minutes from the time at which fast-forward was enabled.

**Step 5 — Finish the remaining timer.**

```bash
/tmp/temporal-vts workflow time-skipping enable \
  --namespace timeskipping-test \
  --workflow-id cba-direct-activity

# Optional: inspect status (or use the Web UI).
/tmp/temporal-vts workflow describe \
  --namespace timeskipping-test \
  --workflow-id cba-direct-activity \
  --time-format iso
```

This enable has no fast-forward duration or ID, so there is no fast-forward to
poll. Expect **Completed**; describe again if still Running. Check both timer
firings and Activity completion in the Web UI.

### 1B. Approval Workflow: stop before the Signal timeout

```bash
WORKFLOW_ID=cba-direct-approval

/tmp/temporal-vts workflow start \
    --namespace timeskipping-test \
    --workflow-id "$WORKFLOW_ID" \
    --type workflowWaitOnSignalAndTimer \
    --task-queue timeskipping-cba
```

Continue with the following procedure. The same procedure is reused for the
Schedule-started approval Workflow in section 2B.

#### Fast-forward the first timer, read the request, signal, and finish

**Step 1 — Optional: fast-forward to the Signal prerequisites.**

Use this bounded fast-forward and poll when the business flow requires the
preceding user timer and Activity to finish before sending a Signal. It is not
a general requirement for sending Signals. If those prerequisites are already
satisfied, skip this step and proceed to the database check.

In this demo, the first Activity creates the approval request that the user
reads before approving. Use the two-hour fast-forward to reach that point
without waiting an hour, or wait for the timer and Activity in wall-clock time.
The target stays before the 24-hour approval timeout.

```bash
/tmp/temporal-vts workflow time-skipping enable \
    --namespace timeskipping-test \
    --workflow-id "$WORKFLOW_ID" \
    --fast-forward-duration 2h \
    --fast-forward-id "${WORKFLOW_ID}-before-signal"

/tmp/temporal-vts workflow time-skipping poll \
    --namespace timeskipping-test \
    --workflow-id "$WORKFLOW_ID" \
    --fast-forward-id "${WORKFLOW_ID}-before-signal" \
    --command-timeout 30s

# Optional: inspect status (or use the Web UI).
/tmp/temporal-vts workflow describe \
    --namespace timeskipping-test \
    --workflow-id "$WORKFLOW_ID" \
    --time-format iso
```

Expected: the initial one-hour timer fires and the first Activity writes the
approval request. Poll reports `completed`, but the Workflow is still **Running**.
`FastForwardInfo.HasCompleted` is true and `EffectiveEnabled` is false: time
skipping automatically turned off at the target. The 24-hour Signal timeout
has not fired. If poll reports a timeout, poll again.

**Step 2 — Confirm the first Activity finished and read the database record.**

```bash
/tmp/temporal-vts workflow show \
    --namespace timeskipping-test \
    --workflow-id "$WORKFLOW_ID"

npm run requests -- "$WORKFLOW_ID"
```

Before signaling, confirm:

- History contains the first `TimerFired`, then `ActivityTaskCompleted` for
  `createApprovalRequest`.
- The database reader returns this Workflow's request with `status: PENDING`.

If the business logic requires the Activity to finish before the user can
signal, **wait for these checks**. Do not infer Activity completion from elapsed
virtual time. Step 3 reads the real `requestId` from this database record.

In the Web UI, verify the first timer fired, the first Activity completed, the
approval timeout timer is pending, and the approval-recording Activity has not run.

**Step 3 — Send the Signal using the database request ID.**

The demo provides an approval command. Run it from the demo directory, with
the same `DEMO_DB_PATH` as the Worker if you customized that setting:

```bash
npm run approve -- "$WORKFLOW_ID"
```

The command reads the current execution's request from SQLite, sends the
`proceed` Signal with its real request ID, and waits up to 30 seconds for the
approval Activity to record `APPROVED`. It uses `TEMPORAL_ADDRESS` and
`TEMPORAL_NAMESPACE`, with the same defaults as the Worker. No request ID needs
to be copied or edited. For a running execution, an already-approved request
returns successfully without sending another Signal.

Expected final output:

```text
APPROVED: <requestId>
```

Continue only after the command succeeds. If the request is not ready, check
that the initial timer fired, the first Activity completed, and the database
path matches the Worker's. If the Workflow has already failed or the request
is `TIMED_OUT`, start a new execution instead. A nonzero exit means approval
was not confirmed; do not resume unrestricted time skipping.

In the Web UI, check that the Signal was received and the 24-hour timeout timer
was canceled. The approval Activity records `APPROVED` before returning, so
history may show its completion shortly after the command returns.

**Step 4 — Skip the final timer only after approval.**

```bash
/tmp/temporal-vts workflow time-skipping enable \
    --namespace timeskipping-test \
    --workflow-id "$WORKFLOW_ID"

# Optional: inspect status (or use the Web UI).
/tmp/temporal-vts workflow describe \
    --namespace timeskipping-test \
    --workflow-id "$WORKFLOW_ID" \
    --time-format iso
```

Expected: **Completed**. The final one-hour timer fires without waiting an hour.
Do not run this unrestricted enable while the approval is still pending: it
could advance to the business timeout instead.

### 1C. Approval Workflow: unrestricted time skipping without a Signal

This is the same Workflow type as 1B, with a different Workflow ID. The existing
Workflow implementation already supports both outcomes; no source change or
Worker restart is needed if the current TypeScript Worker is running this demo.

**Step 1 — Start a separate execution. Do not send a Signal to it.**

```bash
cd ~/projects/demo-timeskipping-cba
WORKFLOW_ID=cba-direct-approval-timeout

/tmp/temporal-vts workflow start \
  --namespace timeskipping-test \
  --workflow-id "$WORKFLOW_ID" \
  --type workflowWaitOnSignalAndTimer \
  --task-queue timeskipping-cba
```

**Step 2 — Enable time skipping without a fast-forward duration.**

```bash
/tmp/temporal-vts workflow time-skipping enable \
  --namespace timeskipping-test \
  --workflow-id "$WORKFLOW_ID"
```

There is no fast-forward ID to poll. This does not stop at the approval wait:
it skips the first one-hour timer, runs the Activity that writes `PENDING`, then
skips the 24-hour Signal timeout because no matching Signal arrives. The timeout
Activity records `TIMED_OUT`, and the Workflow fails. The final one-hour timer
is never scheduled.

**Step 3 — Optional: inspect the database and Workflow outcome.**

```bash
npm run requests -- "$WORKFLOW_ID"

# Optional: inspect status (or use the Web UI).
/tmp/temporal-vts workflow describe \
  --namespace timeskipping-test \
  --workflow-id "$WORKFLOW_ID" \
  --time-format iso

/tmp/temporal-vts workflow show \
  --namespace timeskipping-test \
  --workflow-id "$WORKFLOW_ID"
```

Repeat these checks if tasks are still processing. Expected database status:
`TIMED_OUT`. Expected Workflow status: **Failed**, with message
`Approval Signal timed out` and Application Failure type `ApprovalTimedOut`.
In the Web UI, check that the initial timer and Signal timeout both fired,
no Signal was received, and no final timer was scheduled.

| Check | 1B: bounded fast-forward, then matching Signal | 1C: unrestricted time skipping, no Signal |
| --- | --- | --- |
| First one-hour timer | Fires | Fires |
| Request after first Activity | `PENDING` | Initially `PENDING`, then `TIMED_OUT` |
| 24-hour Signal timeout | Canceled after the Signal | Fires |
| Final database status | `APPROVED` | `TIMED_OUT` |
| Final one-hour timer | Fires after resuming time skipping | Never scheduled |
| Workflow outcome | **Completed**: `Approval <requestId> recorded and final timer completed` | **Failed**: `ApprovalTimedOut` / `Approval Signal timed out` |

Unrestricted time skipping advances through business timeout timers as well as
other user timers. Use the bounded procedure in 1B when external input must
arrive before a timeout.

## Part 2: Schedule

Reuse the server and TypeScript Worker from Part 1. Run these commands in
Terminal 3, from `~/projects/demo-timeskipping-cba`.

Both Schedules use `--interval 7d`: a fixed weekly interval, not a particular
weekday or local time. Neither Schedule has an end date or an action limit.
Upcoming runs continue to move forward as actions execute. Use fresh Schedule
IDs when repeating these tests, especially if an older example created a Schedule
with an action limit. Reaching a fast-forward target turns time skipping off; the Schedule
itself remains active and continues using its virtual clock with wall-clock
time advancing normally.

| Test | Workflow | Overlap policy | Schedule fast-forward | Propagation |
| --- | --- | --- | --- | --- |
| 2A | `workflowWithActivityAndTimer` | `Skip` | One session of 30 days | Enabled by default |
| 2B | `workflowWaitOnSignalAndTimer` | `AllowAll` | Separate 7-day sessions | Disabled; control each Workflow separately |

Schedule and Workflow fast-forwards have separate IDs and targets. A Schedule
poll completing does not mean all of its started Workflows have completed.

### 2A. Weekly Workflow 1 with Skip: fast-forward 30 days

**Step 1 — Create the Schedule without an end date or action limit.**

Use a new Schedule ID so a previous example's action limit does not apply:

```bash
SCHEDULE_ID=cba-weekly-skip-month

/tmp/temporal-vts schedule create \
  --namespace timeskipping-test \
  --schedule-id "$SCHEDULE_ID" \
  --interval 7d \
  --overlap-policy Skip \
  --workflow-id cba-weekly-activity-month \
  --type workflowWithActivityAndTimer \
  --task-queue timeskipping-cba
```

In the Web UI, check the weekly upcoming runs before enabling time skipping.
The command deliberately omits both `--end-time` and `--remaining-actions`.

**Step 2 — Fast-forward 30 days and poll the result.**

This example uses `30d` as a fixed month-length test window, not a calendar-month
increment:

```bash
/tmp/temporal-vts schedule time-skipping enable \
  --namespace timeskipping-test \
  --schedule-id "$SCHEDULE_ID" \
  --fast-forward-duration 30d \
  --fast-forward-id "${SCHEDULE_ID}-30d"

/tmp/temporal-vts schedule time-skipping poll \
  --namespace timeskipping-test \
  --schedule-id "$SCHEDULE_ID" \
  --fast-forward-id "${SCHEDULE_ID}-30d" \
  --command-timeout 30s
```

If poll times out, check the Worker and poll the same ID again. Do not enable
a replacement fast-forward just to retry the wait.

**Step 3 — Optional: describe the Schedule and inspect the fast-forward result.**

```bash
# Optional: inspect status (or use the Web UI).
/tmp/temporal-vts schedule describe \
  --namespace timeskipping-test \
  --schedule-id "$SCHEDULE_ID" \
  --time-format iso
```

Expected: poll returns `completed`. If inspecting the result, count the actions
and check their scheduled start times using describe or the Web UI. A 30-day window contains **four or five**
weekly trigger times, depending on where the window begins relative to the
seven-day interval. Do not assume that one month always means four starts.

If using describe, check:

- The action count and recent actions agree with the weekly trigger times in the window.
- `TimeSkippingInfo.CurrentTime` has advanced by roughly 30 days.
- `FastForwardInfo.HasCompleted` is `true`, and the fast-forward ID matches this test.
- `EffectiveEnabled` is `false` after reaching the fast-forward target.
- Upcoming runs are later than the processed dates and continue to be populated.

The scheduled start times should be seven days apart. Each Workflow inherits
time-skipping enablement, executes its Activity, skips both one-hour timers, and
completes. Open each execution to inspect its actual start time and event history.
`Skip` prevents overlapping runs; here each Workflow finishes before the next
weekly start, so no skipped overlap is expected. Refresh a final Workflow if its
tasks are still processing.

The Schedule remains active after fast-forward. Upcoming runs should advance
past the processed dates and continue to be populated; they are not depleted
by a total-action limit.

### 2B. Weekly Workflow 2 with AllowAll: control approval Workflows independently

Advance the Schedule by **7 days per session**, then test the newly started
Workflow before moving to the next week. Each Schedule fast-forward has a
separate ID. The Workflow uses its own two-hour target before approval.

**Step 1 — Create the Schedule.**

```bash
SCHEDULE_ID=cba-weekly-allow-all

/tmp/temporal-vts schedule create \
  --namespace timeskipping-test \
  --schedule-id "$SCHEDULE_ID" \
  --interval 7d \
  --overlap-policy AllowAll \
  --workflow-id cba-weekly-approval \
  --type workflowWaitOnSignalAndTimer \
  --task-queue timeskipping-cba
```

**Step 2 — Fast-forward the Schedule by one week, with propagation disabled.**

```bash
WEEK=1
SCHEDULE_FAST_FORWARD_ID="${SCHEDULE_ID}-week-${WEEK}"

/tmp/temporal-vts schedule time-skipping enable \
  --namespace timeskipping-test \
  --schedule-id "$SCHEDULE_ID" \
  --fast-forward-duration 7d \
  --fast-forward-id "$SCHEDULE_FAST_FORWARD_ID" \
  --disable-propagation

/tmp/temporal-vts schedule time-skipping poll \
  --namespace timeskipping-test \
  --schedule-id "$SCHEDULE_ID" \
  --fast-forward-id "$SCHEDULE_FAST_FORWARD_ID" \
  --command-timeout 30s

# Optional: inspect status (or use the Web UI).
/tmp/temporal-vts schedule describe \
  --namespace timeskipping-test \
  --schedule-id "$SCHEDULE_ID" \
  --time-format iso
```

Expected: Schedule poll returns `completed`, and the action count increases by
one. The new Workflow is Running, initially waiting on its first one-hour timer.
It has not inherited time-skipping enablement. Virtual time still propagates,
but the Schedule's seven-day target does not become a Workflow target.

**Step 3 — Get the newly started Workflow ID.**

Schedule-started IDs include a scheduled-time suffix. Use the actual ID from the Schedule's recent runs in the Web UI, or run the
optional helper below to read the latest recent action. A valid `WORKFLOW_ID`
is needed for the remaining steps; describe itself is not required if you
already have that ID. Do not guess it or reuse a Part 1 Workflow ID:

```bash
WORKFLOW_ID=$(
  /tmp/temporal-vts schedule describe \
    --namespace timeskipping-test \
    --schedule-id "$SCHEDULE_ID" \
    --output json |
  node -e '
    const actions = JSON.parse(require("fs").readFileSync(0, "utf8")).info.recentActions;
    if (!actions?.length) throw new Error("No started Workflow; inspect the Schedule");
    actions.sort((a, b) => Date.parse(a.scheduleTime) - Date.parse(b.scheduleTime));
    console.log(actions.at(-1).startWorkflowResult.workflowId);
  '
)

echo "$WORKFLOW_ID"
```

Confirm this is the new execution shown in the Schedule's recent runs.

**Step 4 — Optional: fast-forward this Workflow to the Signal prerequisites.**

Use these enable and poll commands only when the business flow requires the
preceding user timer and Activity to finish before the Signal is sent. If they
have already completed, skip this preparation and proceed to approval. Signals
do not generally require a fast-forward or poll first.

This demo's approval helper needs the database record created by the first
Activity. If it is not ready yet, the following two-hour fast-forward avoids
waiting for the initial one-hour timer in wall-clock time. Check the resulting
`PENDING` record before approving.

```bash
/tmp/temporal-vts workflow time-skipping enable \
  --namespace timeskipping-test \
  --workflow-id "$WORKFLOW_ID" \
  --fast-forward-duration 2h \
  --fast-forward-id "${WORKFLOW_ID}-before-signal"

/tmp/temporal-vts workflow time-skipping poll \
  --namespace timeskipping-test \
  --workflow-id "$WORKFLOW_ID" \
  --fast-forward-id "${WORKFLOW_ID}-before-signal" \
  --command-timeout 30s

# Optional: inspect status (or use the Web UI).
/tmp/temporal-vts workflow describe \
  --namespace timeskipping-test \
  --workflow-id "$WORKFLOW_ID" \
  --time-format iso

npm run requests -- "$WORKFLOW_ID"
```

Expected: Workflow fast-forward completes, but the Workflow remains Running
and its request is `PENDING`. The initial timer and first Activity have finished;
the 24-hour approval timeout has not fired. This two-hour Workflow target is
independent of the Schedule's seven-day target. Other executions are unaffected.

**Step 5 — Approve using the demo helper.**

```bash
npm run approve -- "$WORKFLOW_ID"
```

Wait for `APPROVED: <requestId>` and a successful exit before continuing. The
helper reads the real request ID, sends `proceed`, and confirms the database
update. If it fails, investigate before enabling unrestricted time skipping.

**Step 6 — Enable unrestricted Workflow time skipping; optionally inspect completion.**

```bash
/tmp/temporal-vts workflow time-skipping enable \
  --namespace timeskipping-test \
  --workflow-id "$WORKFLOW_ID"

# Optional: inspect status (or use the Web UI).
/tmp/temporal-vts workflow describe \
  --namespace timeskipping-test \
  --workflow-id "$WORKFLOW_ID" \
  --time-format iso
```

Expected: **Completed** after the final one-hour timer. Refresh describe if
still Running. In the Web UI, check the Signal, canceled approval timeout,
approval Activity, and final timer firing.

**Step 7 — Repeat for the next week.**

Set `WEEK=2` in Step 2 and repeat Steps 2–6. This creates a new Schedule
fast-forward ID, starts the next weekly execution, and reads its actual Workflow
ID. After two iterations, the action count should be 2, both requests should be
`APPROVED`, and both Workflows should be Completed.

`AllowAll` also permits overlapping executions. This step-by-step walkthrough
finishes each execution before advancing another week. To observe overlap,
you can leave the first execution pending, advance the next seven days with a
new fast-forward ID, then inspect both Running executions before approving them.

## Command reference

### Build, server, and demo helpers

| Command | Meaning |
| --- | --- |
| `go build -o /tmp/temporal-vts ./cmd/temporal` | Builds one executable containing the CLI client and embedded local dev server |
| `/tmp/temporal-vts server start-dev` | Starts the local Temporal Server and Web UI |
| `npm ci` | Installs the demo dependencies from `package-lock.json` |
| `npm run worker` | Compiles TypeScript and starts the Worker for both Workflows and their Activities |
| `npm run requests -- "$WORKFLOW_ID"` | Reads this Workflow's approval records from SQLite; does not send a Signal |
| `npm run approve -- "$WORKFLOW_ID"` | Compiles and runs the approval client, reads the real request ID, sends `proceed`, and waits for database status `APPROVED` |

`npm run` executes a named script from `package.json`. The `--` passes subsequent
arguments to that script. `$WORKFLOW_ID` is a shell variable assigned in each test.
Run database helpers from the demo directory so they use the Worker's database.

### Temporal commands

| Command | Meaning |
| --- | --- |
| `workflow start` | Creates a Workflow Execution; this command does not enable time skipping |
| `workflow time-skipping enable` with a duration | Replaces the time-skipping configuration and advances toward a bounded fast-forward target; skipping turns off when the target is reached |
| `workflow time-skipping enable` without a duration | Enables unrestricted skipping, which can advance through business timeouts and drive the Workflow to a terminal state |
| `workflow time-skipping poll` | Waits for one fast-forward ID's result; `completed` does not mean the Workflow completed |
| `workflow time-skipping disable` | Turns time skipping off without canceling the Workflow |
| `workflow describe` | Optional read-only inspection of execution status, result or failure, and available time-skipping information |
| `workflow show` | Reads event history to inspect timer, Activity, Signal, and time-skipping events |
| `schedule create` | Creates a Schedule that starts Workflows using its specification and overlap policy |
| `schedule time-skipping enable` | Enables skipping on the Schedule with a required fast-forward duration |
| `schedule time-skipping poll` | Waits for the specified Schedule fast-forward result |
| `schedule time-skipping disable` | Turns Schedule time skipping off without deleting the Schedule |
| `schedule describe` | Optional read-only inspection of Schedule status, recent started Workflows, and time-skipping information |

### Flags used below

| Flag | Meaning |
| --- | --- |
| `--namespace timeskipping-test` | Selects the Namespace by name; on `start-dev`, creates it |
| `--enable-time-skipping` | Makes Workflow and Schedule time skipping available in all Namespaces on this dev server; also enables CHASM creation and routing for new Schedules. Individual executions still need time skipping enabled |
| `--workflow-id` / `--schedule-id` | Identifies the Workflow or Schedule to create or operate on |
| `--type` | Names the Workflow function registered by the Worker |
| `--task-queue timeskipping-cba` | Routes tasks to this demo's Worker |
| `--fast-forward-duration` | Sets how far ahead of current virtual time to advance, such as `90m`, `2h`, or `10d` |
| `--fast-forward-id` | Labels one fast-forward so it can be polled; generated if omitted with a duration |
| `--command-timeout` | Limits this CLI command's wait; does not stop the fast-forward |
| `--time-format iso` | Shows absolute RFC 3339 timestamps instead of relative text such as `1 hour from now` |
| `--output json` / `jsonl` | Selects structured output on stdout; errors remain on stderr |
| `--interval 7d` | Gives the Schedule a fixed seven-day (weekly) interval |
| `--overlap-policy Skip` | Skips a scheduled start if the previously started Workflow is still running |
| `--overlap-policy AllowAll` | Starts each scheduled Workflow even if earlier executions are still running |
| `--disable-propagation` | Does not pass the Schedule's time-skipping enabled state to started Workflows. Fast-forward targets are never propagated; virtual time still propagates |


### Running the examples

Run each numbered step separately and check its expected result before continuing.
Keep the server and Worker running in their own terminals.

- **Optional inspection:** `workflow describe` and `schedule describe` only read
  status; they do not advance time, send Signals, or change configuration. Skip
  these checks if you are inspecting the same state in the Web UI.
- **Optional preparation before a Signal:** use a bounded Workflow fast-forward
  and poll when the preceding user timer and Activity must finish before the
  business action. Skip this preparation if its prerequisites are already met.
- **Approval confirmation:** for this demo, wait for `npm run approve` to succeed
  and report `APPROVED` before resuming unrestricted time skipping.
- Use fresh Workflow/Schedule IDs when repeating tests on the same server.


## Output and optional checks

`workflow describe` and `schedule describe` are optional read-only checks. Use
`--time-format iso` for absolute RFC 3339 timestamps instead of relative text.

Use `--command-timeout` to limit a poll's wait. Without it, polling continues
until the fast-forward completes, fails, or the command is interrupted. A command
timeout does not stop the fast-forward; poll the same ID again to check progress.

| Outcome | stdout | stderr | Exit status |
| --- | --- | --- | --- |
| Completed | `completed`, or `{"completed":true}` with `--output json` / `jsonl` | Empty | 0 |
| Fast-forward failed | Empty | `Error: fast-forward failed: <reason>` | 1 |
| Command timeout | Empty | `Error: program interrupted` | 1 |

Use `echo $?` immediately after a command to inspect its exit status.

## Repeat a test or investigate unexpected results

- Use a fresh Workflow or Schedule ID when repeating a test. An existing running
  execution or Schedule is not replaced by these examples.
- If a Workflow or poll makes no progress, check the Worker terminal. It must be
  running against `127.0.0.1:7233`, Namespace `timeskipping-test`, task queue
  `timeskipping-cba`. Server and client commands must use `/tmp/temporal-vts`.
- If a poll command times out, it has only stopped waiting. Inspect the execution,
  check the Worker, and poll the same ID again; do not automatically enable a
  new fast-forward.
- For approval tests, resume unrestricted skipping only after `npm run approve`
  succeeds and reports `APPROVED`. If the Workflow has already failed, start a
  new execution; sending a Signal cannot reopen it.
- If `requests` returns no record, the initial timer or first Activity may still
  be pending. Also check that the Worker and helpers use the same database path.
- A Workflow's **Failed** status in test 1C is expected business behavior, not a
  failure to execute the demo.

The Workflows accept `timerMs`; the approval Workflow also accepts
`signalTimeoutMs`. These optional inputs use milliseconds. CLI duration flags
require units, such as `--fast-forward-duration 2h`.
