# ChatGPT resume queue

The queue uses the user's existing signed-in ChatGPT sidebar. There is no API
provider or separate backend. It operates the composer through the extension's
isolated content script and reads the reply associated with its own submitted
delivery marker. This is a browser UI integration, so site markup and account
behavior need live verification and ongoing maintenance.

## Current mode: explicit Add handoff

Add to queue saves an immutable request with a delivery ID and exact prompt, copies
that prompt, switches to Chat, and schedules only that new request. Under the shared
runner lock it preflights Sidebar Chat, opens a new conversation, inserts the prompt
into the empty active composer, verifies retention, and invokes the native Send
control once. It monitors the matching delivery and saves valid resume JSON before
Ready. A native Send click is used instead of a synthetic Enter key, which websites
may ignore. Existing draft equality, authorization and acknowledgement checks apply.

Permission is panel-local and consumed once. New Adds during collection are saved
and copied immediately, then processed sequentially. Older queued jobs are not
selected. Reload, Pause and manual navigation discard pending permissions. Unknown
authentication, a personal draft/attachment, uncertain delivery, or save failure
stops advancement. There is no blind draft clearing, automatic reinsertion or resend.
A new conversation provides an empty composer; unexpected restored text is preserved.

Clipboard failure leaves the request saved without scheduling Send and opens a
selected readonly prompt. Card/Details Copy prompt remains clipboard-only. Bulk
Start/Continue/regeneration sending stays paused; Add is a separate explicit action.
Browser tests use only synthetic HTTPS documents in a disposable Chrome profile.

The default-on **Check existing company or URL** option is stored locally. Both
Add and Ctrl+Enter check all current queue entries and saved results for the
selected candidate inside the IndexedDB write transaction. Matching either a
company name (case/space normalized) or a job URL (tracking parameters removed,
job selectors preserved) rejects the entire Add before its Send permission is
created. A dismissible **Already applied** status identifies queue or saved
results; no clipboard write, navigation, composer insertion or submission occurs.
There is no separate application tracker in this runtime. Examples, cancelled
requests, confirmed terminal failures and base resumes do not block new jobs.
Turning the option off permits deliberate repeat companies. Historical metadata
and provenance are never rewritten by the check.

## Connection choice

Add always uses Sidebar Chat. Settings → ChatGPT queue selects Sidebar Chat (default)
or ChatGPT tab for inspection and the retained bulk/recovery tools. The latter
adapts the normal-tab messaging workflow reviewed in
[Multi-AI-Prompt](../baseline/multi-ai-prompt/README.md). It uses a dedicated tab in
the panel's window and activates it before sending. Existing personal tabs are
never repurposed. Check connection inspects the selected connection; Open selected
ChatGPT shows it for sign-in or manual verification. Both modes use the same
submission, delivery matching, capture, and resume-validation adapter.

The selected mode is stored locally. Each run pins its connection and records the
connection on each delivery attempt. Recovery refuses a different connection
instead of silently creating a second delivery. The tab ID is retained in session
storage per window, so reopening the sidebar reconnects to the same tab. A closed,
reloaded, or manually navigated tab interrupts collection; the queue never assumes
that this means Send failed. Starting recovery reads the recorded conversation.

## Using it

1. Reload the unpacked extension after building.
2. Sign in to ChatGPT normally and check Chat in the sidebar.
3. Open Profile, download the example format, and import your completed JSON.
4. Read a job or paste its description, select instructions, and Add to queue.
5. Chat opens, the prompt is copied, and the new request is sent in a fresh conversation.
6. Open Job Queues to inspect progress; Review opens the saved originating chat.

Adding a job explicitly authorizes that new request. Existing Chat drafts and attachments block the
runner. Pause finishes the current response, then stops; a correction is not sent
after Pause. Opening another conversation or manually reloading pauses the queue.
The sidebar must stay open for progress, but Chat and Studio can switch views.

## Connection checks

The user menu's Check connection action inspects the embedded ChatGPT page without
sending a message. It reports composer availability, generation activity, whether
there is an unsent draft, and which public account UI signals were found. It does
not read authentication tokens, cookies, private session endpoints, or chat message
contents for authentication. Saved-conversation links and loaded conversation structure are used as
additional UI signals so a missing profile-button selector is not treated as proof
that the user is signed out.

The toolbar search separately reads bounded titles and URLs from ChatGPT's rendered
history, independent of candidate/queue records. It refreshes on focus or Refresh
and filters titles locally. Those titles stay in panel memory and are excluded
from storage and delivery diagnostics. Selecting a row performs the same current
route, draft, generation and native-link checks as history arrows. A cached row
can be selected while refreshing; the host waits for inspection and revalidates
the target before its single navigation click. Reading the list can preserve an
existing draft, but opening another chat remains blocked until it is cleared or sent.

When the layout remains unknown, the user can verify their account in Chat and
choose Use this signed-in session. That confirmation is held only in the current
panel's memory and is cleared by sign-in/logged-out signals or panel closure.
An explicit signed-out page is always blocked, including immediately before Send;
confirmation cannot override it. Successful checks restore only authentication-
blocked requests with no persisted send intent, without authorizing an automatic retry.
Previously submitted or ambiguous deliveries remain on the recovery path.

The template is self-contained. The optional official OpenAI browser-control
extension is for desktop-agent access to browser tabs and is not a dependency of
this queue. Browser installations and signed-in sessions are separate per profile.

## Candidate JSON v1

```json
{
  "schemaVersion": 1,
  "name": "Example Candidate",
  "role": "Software Engineer",
  "summary": "Software engineer developing reliable services.",
  "skills": ["TypeScript", "SQL"],
  "experience": [{
    "title": "Software Engineer",
    "company": "Example Company",
    "startDate": "2022-01",
    "endDate": "Present",
    "sentences": ["Built and maintained web services."]
  }],
  "education": [{
    "degree": "B.S. Computer Science",
    "institution": "Example University"
  }]
}
```

Required fields: name, role, summary, skills, experience, education. Arrays can
be empty. Employment records require title, company, sentences; education records
require degree. Both support optional startDate, endDate, and location; education
also supports institution. Optional contact fields are email, phone, location,
website, linkedin. File size is limited to 250 KB and normalized profile content
to 200 KB. Unknown fact fields are rejected so imported information is not silently
discarded. PDF/DOCX parsing and document export are separate future work.

## Queue and storage

`queue-store.mjs` uses IndexedDB transactions for requests, profiles, and control
state. Each job has a UUID, immutable input snapshot, delivery attempts, raw output,
validated resume, and source URL. Web Locks coordinate one runner across extension
windows. BroadcastChannel refreshes other open views. The runner lives in the
panel, so it does not depend on a continuously running Manifest V3 service worker.

The lifecycle is Queued -> Preparing -> Sending -> Generating -> Validating -> Ready.
Unsent/interrupted requests preserve drafts; uncertain deliveries require explicit
reconciliation. Saving retains captured output for save-only retry. Invalid-output
and error-response are terminal, completed outcomes, hidden from the active queue
and accessible through Completed failures. Cancelled records remain in storage.
The IndexedDB version stays at 1: new states and optional fields preserve existing
records. Legacy attention records are conservatively interpreted from their
recorded delivery evidence; legacy queued records with prior submission evidence
cannot authorize another send without explicit regeneration.

Before clicking Send, the frame requests authorization. The host checks Pause and
persists the delivery intent; only then does the frame receive permission for one
click. Composer comparison reads paragraph/line-break structure directly instead
of layout-dependent `innerText`, allowing rich-text editors to format paragraphs
without changing the queued content. It waits for an enabled Send control and
verifies the draft again immediately before the click. A dispatched click is
recorded separately from an acknowledged user turn; no acknowledgement causes
an uncertain state rather than another click. The matching user turn and saved conversation
URL register the company chat immediately, while the response is still generating.
Collection tracks the next assistant turn in that conversation, idle/final
UI signals, and stable text. Results must include the original request UUID and
schema version. Each delivery has a separate marker so separate attempts and old replies
cannot be confused.

The fresh-chat command verifies the current draft before choosing an empty Home,
a single native New chat click, or a full-load fallback when no safe control is
available. A dispatched native navigation must resolve to Home with an editable,
empty composer and no old turns; unexpected routes, restored drafts or cancellation
stop the handoff. No fallback/reclick occurs after an uncertain native dispatch.
Host readiness is signalled directly rather than polling every 100 ms. Adapter
waiters observe input/change, route events, aria-disabled and streaming attributes;
the 250 ms fallback remains for unobservable property changes, with deadlines intact.

Capture reads DOM text without forcing rendered `innerText` layout. For a parseable
schemaVersion 1 JSON envelope matching the request, enabled turn-level completion
controls and idle streaming must remain stable for 180 ms. Generic Copy controls
or invalid/non-JSON output keep the original 1.25 s quiet period. The settling timer
wakes at its deadline rather than waiting for a polling tick. Host validation,
durable capture, save retry and Ready semantics are unchanged. Pre-Send Pause,
owner and request checks share the transaction that persists send intent. Redundant
same-turn acknowledgement writes are omitted; intent/dispatch/acknowledgement stay
distinct. Diagnostics include completionObservedAt and capturedAt timestamps without
storing response content in diagnostic logs.

Captured output is journaled in extension session storage as an additional
recovery aid, then saved to IndexedDB before validation. Session storage survives
panel/worker closure but not a browser restart; IndexedDB is the durable record.
If both storage mechanisms fail, keep the panel open and retry saving. Raw output
is retained in memory until saved and remains available in the original ChatGPT
conversation. The extension never treats an uncertain send as permission to resend.

## Validation and completed outcomes

The output envelope is `{schemaVersion:1, requestId, resume}`. The parser accepts
one JSON object, optionally in one JSON fence, and checks identity, schema, fixed
profile facts, contact fields, and supported skills. A missing company stays an
empty string rather than an invented employer. Valid JSON and Ready are committed
together only after raw capture is saved. Generated prose still needs human review.

Completion requires the owned user marker, associated assistant turn, a saved
conversation URL, idle generation, available final controls, and stable text.
Only such captures can become terminal invalid output or a completed error/refusal.
Missing acknowledgement, timeout, navigation, connection loss, and storage errors
are never interpreted as completed error responses. Eligible jobs can proceed after
a safely archived terminal result, while uncertainty and storage failures pause.
There is no automatic formatting correction or resend of completed invalid output.

## Recovery and regeneration

Continue/reconcile handles one request under the shared runner lock. A matching
prepared draft with no recorded intent/dispatch/acknowledgement can be submitted
with the same delivery marker. An existing matching user turn is monitored without
another click. If the draft is absent or different, it is preserved; reconciliation
will not insert another prompt or create a new attempt. An acknowledged or uncertain
delivery is reconciled read-only through its recorded conversation. Missing references
require inspection and manual connection, not permission to resend.

Generate again is a distinct action. Its dialog shows the previous state/evidence
and duplicate-generation possibility. The API also requires confirmation for prior
submission evidence and rejects stale dialog references. Previous raw captures,
results, and attempts remain in history. The new attempt is queued; Start queue is
still explicit. Retry save does not run generation. Review opens the recorded chat;
Details exposes inputs, provenance, captures, and redacted diagnostics separately.

## Runtime and composer diagnostics

The build computes a deterministic SHA-256 fingerprint over runtime inputs. Host,
frame, and normal-tab adapter report their identity. An unbuilt source checkout,
missing adapter fingerprint, or mismatch cannot authorize generation. Settings and
Check connection show these values without assuming Chrome loaded the disk build.

Connection inspection separates composer presence/readiness, recognized/unknown/
signed-out authentication evidence, host panel-session confirmation and its scope,
generation activity, and draft detection. A composer does not prove authentication.
Confirmation remains memory-only and distinct between sidebar and tab connections;
explicit sign-out clears it.

Composer checks reacquire the current connected editor around insertion, waiting,
authorization, and the final click boundary. A replaced node is not authoritative.
A new editor retaining the exact normalized prompt can continue without reinsertion;
missing or different text stops the attempt. Equality normalization is unchanged.

Diagnostics whitelist bounded IDs, phase timestamps, build ID, editor type and
connectivity, identity changes, normalized lengths, mismatch position, and recorded
intent/dispatch/acknowledgement. They exclude prompt, resume, answer, account, and
HTML content. Raw responses are business captures in Details/history, not diagnostic
logs. The live cause of the reported composer failure remains unestablished.

## Verification

The unit tests cover profile/output validation, snapshots, sequential processing,
explicit regeneration, Pause, shared runner exclusion, interrupted/uncertain delivery,
and save retries without another generation. Isolated Chrome tests exercise the
real extension and native side panel with synthetic ChatGPT/job fixtures, including
textarea, paragraph, and mixed text/div composers, modern Send controls, continuing
an unsent draft, registering company chats during generation, closing a running
panel, read-only recovery, and usage-limit handling.
The account regression checks use a layout with no recognized account menu, cover
in-extension confirmation and requeue without sending, and verify that visible
signed-out UI still blocks a previously confirmed session.
Normal-tab tests cover saved mode selection, actual content-script ports, tab
activation, personal-tab isolation, worker draft preservation,
connection locking, and recovery after sidebar closure without duplicate sending.

Fixture tests do not prove compatibility with every live ChatGPT UI or account.
No prompts are submitted to the user's real account by the test suite. A separate,
explicitly authorized synthetic live test is needed for account-level verification.

Focused isolated adapter tests cover editor replacement with retained/discarded
text, unexpected drafts, edits while waiting for Send, final-boundary changes,
navigation, cancellation, stale authorization, delayed/missing acknowledgement,
unknown authentication, and completed-error versus unfinished-response evidence.
No live browser profile or account is used.
