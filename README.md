## Workflow and Schedules Prepared For Testing

Two example workflows are provided in the demo project written in TypeScript:

- **Workflow 1 — `workflowWithActivityAndTimer`** is a simple workflow with activities and user timers. Simply enabling time skipping allows it to advance through its timers and run to completion.
- **Workflow 2 — `workflowWaitOnSignalAndTimer`** represents a more complex Workflow that includes user timers, activities, and aignals. It waits for a Signal with a timeout implemented as a user timer. We assume that the business flow requires the Signal to be sent only after the preceding user timers and Activities have completed.

These two Workflows are expected to be started by Schedules: 

- one weekly Schedule runs Workflow 1 with the **Skip** overlap policy
- and another weekly Schedule runs Workflow 2 with the **AllowAll** overlap policy.

## A Step-by-Step Guideline to Use Time Skipping

#### **Step1: build CLI commands, start local server and worker**

```bash
# build local commands
cd /path/to/the/feature-specific-CLI-repo
go build -o /tmp/temporal-vts ./cmd/temporal

# start local server with time skipping
/tmp/temporal-vts server start-dev \
  --namespace timeskipping-test \
  --enable-time-skipping
```

Open **http://localhost:8233**, select the namespace of **timeskipping-test**, and leave the server
running. Its address is `127.0.0.1:7233`.

```bash
cd /path/to/demo-timeskipping-cba
npm ci
npm run worker
```

#### **Step2: use time skipping on schedules (overlap-policy=skip) with workflow-1**

```bash
# create the weekly schedule and check upcoming runs in the UI

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

```bash
# fast-forward by 30days
/tmp/temporal-vts schedule time-skipping enable \
  --namespace timeskipping-test \
  --schedule-id "$SCHEDULE_ID" \
  --fast-forward-duration 30d \
  --fast-forward-id "${SCHEDULE_ID}-30d"
  
# check in UI
 
# optional: poll until time skipping completes
/tmp/temporal-vts schedule time-skipping poll \
  --namespace timeskipping-test \
  --schedule-id "$SCHEDULE_ID" \
  --fast-forward-id "${SCHEDULE_ID}-30d" \
  --command-timeout 30s
  
# optional: inspect time skipping status
/tmp/temporal-vts schedule describe \
  --namespace timeskipping-test \
  --schedule-id "$SCHEDULE_ID" \
  --time-format iso
```

Expected runs to be found in UI, workflows started by default also have time-skipping enabled and completes fast

!image.png

#### **Step3: use time skipping on schedules (overlap-policy=allow-all) with workflow-2**

```bash
# fast-forward 15 days to start 2 workflows with a weekly schedule
# and disable time-skipping propagation 
# with "allow-all", the second workflow can be started with the first one still running

SCHEDULE_ID="cba-weekly-allow-all"

/tmp/temporal-vts schedule time-skipping enable \
  --namespace timeskipping-test \
  --schedule-id "$SCHEDULE_ID" \
  --fast-forward-duration 15d \
  --fast-forward-id "$SCHEDULE_FAST_FORWARD_ID" \
  --disable-propagation
  
# list running workflows and paste the worklfow ID
/tmp/temporal-vts workflow list \
  --namespace timeskipping-test \
  --query "TemporalScheduledById = 'cba-weekly-allow-all' AND ExecutionStatus = 'Running'"
```

How to use time skipping on workflows:

```bash
# If we don't want the signal to time out and send an approval just when 
# the workflow is waiting on the signal.

# 1) we skip the timer before the signal:
/tmp/temporal-vts workflow time-skipping enable \
  --namespace timeskipping-test \
  --workflow-id "$WORKFLOW_ID" \
  --fast-forward-duration 2h \
  --fast-forward-id "${WORKFLOW_ID}-before-signal"

# Optionally poll the fast-forward result
/tmp/temporal-vts workflow time-skipping poll \
  --namespace timeskipping-test \
  --workflow-id "$WORKFLOW_ID" \
  --fast-forward-id "${WORKFLOW_ID}-before-signal"

# 2) send an approve signal to the workflow
npm run approve -- "$WORKFLOW_ID"

# 3）enable time skipping for the workflow to run to completion
/tmp/temporal-vts workflow time-skipping enable \
  --namespace timeskipping-test \
  --workflow-id "$WORKFLOW_ID"
  
# check the workflow in webUI to see the final result
# alternatively:
# if we don't do 1)2) and just perform 3) or just 
# use time skipping propagation from schedules, the signal will time out and 
# this workflow will end in a state that no one "approves" it.

```
