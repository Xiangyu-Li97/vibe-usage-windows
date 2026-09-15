# Confirming Windows process-tree exit

`TerminateJobObject` initiates termination. Job accounting reaching zero is
not sufficient evidence that every process object has finished termination.
A fixed 500 ms quiescence delay evaluated during acceptance could still let
immediate uninstall race a descendant's teardown.

The Windows supervisor now:

1. Keeps a duplicate of the root process handle before resuming that process.
2. On cancellation or quit, limits its private job to one active process before
   enumerating members. A live parent occupies that slot, so subsequent child
   admission fails; the already-associated members are not evicted by this step.
3. Opens wait/query handles for the member snapshot, verifies job membership to
   avoid retaining an unrelated process if a PID was reused, then terminates
   the private job. A vanished process is distinguished from other query errors.
4. Retains those handles across repeated cancellation/quit calls. Cleanup is
   confirmed only when accounting is zero, every retained handle is signaled,
   and no snapshot/termination error made the result uncertain.

The user-space drain loop has a five-second deadline. Timeout or an uncertain
snapshot returns **false** and is logged; the application then takes its existing
bounded exit fallback with kill-on-job-close. `shutdown_attempt_finished` only
releases the exit-request gate; it does not assert that cleanup succeeded. Kernel
I/O that does not finish in time is not claimed to be fixed by this mechanism.
Installer exit 3010 still means pending reboot cleanup, not a clean uninstall.

The policy applies only to managed local CLI/probe jobs. It does not enumerate
and kill all Node processes, change Windows security policy, or own browser and
updater launches. No credentials or command-line contents are used for matching.

Regression coverage retains the original child/grandchild, cancellation,
unrelated-process, and executable-unlock assertions. New tests simulate zero
accounting with an unsignaled waitable handle, retain that handle over repeated
termination calls, reject uncertain completion, exercise the timeout result,
and confirm a managed Node cannot create a new child after admission closes.
The synthetic waitable-handle test is deterministic contract coverage, not a
claim to reproduce every kernel teardown delay.

Run the native tests through `scripts/cargo-windows.ps1`, then validate a newly
built installed Release in both ordinary-user and administrator contexts. In
each context quit with a managed Node still present and immediately uninstall;
retain the first failure, exact residues, and an unrelated helper's survival.

References: [TerminateProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess),
[job active-process limit](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information),
[job process list](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_process_id_list).
