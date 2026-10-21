"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CATEGORY_LABELS,
  CHANNELS,
  type Category,
  type ChannelKey,
  type DraftVoice,
} from "@/lib/domain";
import { isOpportunityItem, isQuestionItem } from "@/lib/backlog";
import { blockEligibility } from "@/lib/moderation-rules";
import { SPAM_SIGNATURE_LABELS, type SpamSignature } from "@/lib/graduation";
import { fmtDay, youtubeCommentUrl } from "@/lib/format";
import type { QueueItem } from "@/lib/mock";

const CATEGORY_STYLES: Record<Category, string> = {
  respond: "bg-emerald-100 text-emerald-900",
  ignore: "bg-neutral-100 text-neutral-700",
  delete_troll: "bg-orange-100 text-orange-900",
  delete_spam: "bg-red-100 text-red-900",
  flag_political: "bg-amber-100 text-amber-900",
};

const VOICE_LABELS: Record<DraftVoice, string> = {
  josh: "Josh voice",
  jeb: "Jeb voice",
  house: "House voice",
};

type View = "needs_reply" | Category | "all";

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "needs_reply", label: "Needs a reply" },
  { value: "respond", label: CATEGORY_LABELS.respond },
  { value: "flag_political", label: CATEGORY_LABELS.flag_political },
  { value: "delete_troll", label: CATEGORY_LABELS.delete_troll },
  { value: "delete_spam", label: CATEGORY_LABELS.delete_spam },
  { value: "ignore", label: CATEGORY_LABELS.ignore },
  { value: "all", label: "All pending" },
];

type Action = "post_reply" | "hide" | "hide_and_block" | "dismiss";
type Outcome = { ok: boolean; message: string };

function inView(c: QueueItem, view: View): boolean {
  if (view === "all") return true;
  if (view === "needs_reply") return c.category === "respond" || c.category === "flag_political" || isOpportunityItem(c);
  return c.category === view;
}

export function ReviewQueue({
  comments,
  channels,
  demo,
}: {
  comments: QueueItem[];
  channels: ChannelKey[];
  // Sample data: actions only change local state, nothing is sent anywhere.
  demo: boolean;
}) {
  const router = useRouter();
  const [channelFilter, setChannelFilter] = useState<ChannelKey | "all">("all");
  const [view, setView] = useState<View>("needs_reply");
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [busy, setBusy] = useState<Record<string, Action | undefined>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () =>
      comments.filter(
        (c) => !cleared.has(c.id) && (channelFilter === "all" || c.channel === channelFilter) && inView(c, view),
      ),
    [comments, channelFilter, view, cleared],
  );

  const handled = filtered.filter((c) => outcomes[c.id]?.ok);
  const pendingCount = filtered.length - handled.length;

  async function act(c: QueueItem, action: Action) {
    const text = drafts[c.id] ?? c.draftReply ?? "";
    if (action === "post_reply" && !text.trim()) {
      setOutcomes((p) => ({ ...p, [c.id]: { ok: false, message: "Write a reply first." } }));
      return;
    }
    if (demo || !c.reviewId) {
      setOutcomes((p) => ({ ...p, [c.id]: { ok: true, message: demoMessage(action) } }));
      return;
    }
    setBusy((p) => ({ ...p, [c.id]: action }));
    try {
      const res = await fetch("/api/review/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: c.reviewId, action, text: action === "post_reply" ? text : undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setOutcomes((p) => ({
        ...p,
        [c.id]: res.ok
          ? { ok: true, message: data.message ?? "Done." }
          : { ok: false, message: data.error ?? `Failed (HTTP ${res.status}).` },
      }));
    } catch (err) {
      setOutcomes((p) => ({ ...p, [c.id]: { ok: false, message: err instanceof Error ? err.message : "Network error" } }));
    } finally {
      setBusy((p) => ({ ...p, [c.id]: undefined }));
    }
  }

  function clearHandled() {
    setCleared((prev) => {
      const next = new Set(prev);
      handled.forEach((c) => next.add(c.id));
      return next;
    });
    if (!demo) router.refresh();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {channels.length > 1 && (
          <Segmented
            value={channelFilter}
            onChange={(v) => setChannelFilter(v as ChannelKey | "all")}
            options={[
              { value: "all", label: "All channels" },
              ...channels.map((c) => ({ value: c, label: CHANNELS[c].displayName })),
            ]}
          />
        )}
        <Segmented value={view} onChange={(v) => setView(v as View)} options={VIEW_OPTIONS} />
        {handled.length > 0 && (
          <button
            type="button"
            onClick={clearHandled}
            className="ml-auto rounded-btn border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-bone"
          >
            Clear handled ({handled.length})
          </button>
        )}
        <span className={`text-sm text-ink-muted ${handled.length > 0 ? "" : "ml-auto"}`}>{pendingCount} pending</span>
      </div>
      {view === "needs_reply" && (
        <p className="mb-3 text-xs text-ink-muted">
          Possible leads first, then questions, then other comments worth a reply, newest first within each group.
          Threads a host already answered on YouTube drop out on the next sync.
        </p>
      )}

      <ul className="space-y-3">
        {filtered.map((c) => (
          <li key={c.id}>
            <CommentCard
              comment={c}
              outcome={outcomes[c.id]}
              busy={busy[c.id]}
              draft={drafts[c.id] ?? c.draftReply ?? ""}
              onDraftChange={(text) => setDrafts((prev) => ({ ...prev, [c.id]: text }))}
              onAct={(a) => act(c, a)}
            />
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-ink-muted">
            Nothing here with these filters.
          </li>
        )}
      </ul>
    </div>
  );
}

function demoMessage(action: Action): string {
  switch (action) {
    case "post_reply":
      return "Sample only: in the live queue this posts the reply on YouTube.";
    case "hide":
      return "Sample only: in the live queue this hides the comment (reversible).";
    case "hide_and_block":
      return "Sample only: in the live queue this removes the comment and blocks the author.";
    case "dismiss":
      return "Sample only: dismissed.";
  }
}

function CommentCard({
  comment,
  outcome,
  busy,
  draft,
  onDraftChange,
  onAct,
}: {
  comment: QueueItem;
  outcome?: Outcome;
  busy?: Action;
  draft: string;
  onDraftChange: (text: string) => void;
  onAct: (a: Action) => void;
}) {
  const c = comment;
  const done = !!outcome?.ok;
  const isDelete = c.category === "delete_troll" || c.category === "delete_spam";
  const block = blockEligibility({
    category: c.category,
    confidence: c.confidence,
    priorOffenses: c.authorOffenseCount ?? 0,
    alreadyBlocked: c.authorBlocked,
  });
  const canReply = c.category === "respond" || c.category === "flag_political";
  const hasEmDash = /[\u2014\u2013]/.test(draft);
  const link = c.videoId && c.platformCommentId ? youtubeCommentUrl(c.videoId, c.platformCommentId) : null;

  return (
    <div className={`rounded-2xl border border-line bg-white p-4 shadow-sm transition ${done ? "opacity-60" : ""}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-medium ${CATEGORY_STYLES[c.category]}`}>
          {CATEGORY_LABELS[c.category]}
        </span>
        <span className="text-ink-muted">{Math.round(c.confidence * 100)}% confidence</span>
        <span className="text-ink-muted">· {CHANNELS[c.channel].displayName}</span>
        <span className="text-ink-muted">· {fmtDay(c.publishedAt)}</span>
        {c.category === "respond" && isQuestionItem(c) && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-900">Question</span>
        )}
        {c.category === "delete_spam" && c.spamSignature && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-800">
            {SPAM_SIGNATURE_LABELS[c.spamSignature as SpamSignature] ?? c.spamSignature}
          </span>
        )}
        {c.clusterWith && c.clusterWith.length > 0 && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-800">spam cluster of {c.clusterWith.length + 1}</span>
        )}
        {(c.authorOffenseCount ?? 0) > 0 && (
          <span className="rounded-full bg-orange-50 px-2 py-0.5 text-orange-800">
            author has {c.authorOffenseCount} prior flag{c.authorOffenseCount === 1 ? "" : "s"}
          </span>
        )}
        {isOpportunityItem(c) && (
          <span className="rounded-full bg-gold/25 px-2 py-0.5 font-medium text-ink">
            {c.opportunityType === "loan" ? "Loan lead" : "Real estate lead"} · {Math.round((c.opportunityScore ?? 0) * 100)}%
          </span>
        )}
      </div>

      <div className="mb-1 text-sm font-medium text-ink">
        {c.author}
        {c.isReply && <span className="ml-2 text-xs font-normal text-ink-muted">(reply in a thread)</span>}
      </div>
      {c.videoTitle && <div className="mb-2 text-xs text-ink-muted">on “{c.videoTitle}”</div>}
      <p className="mb-3 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{c.text}</p>

      {c.triageError && (
        <p className="mb-3 rounded-btn border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{c.triageError}</p>
      )}

      {c.category === "flag_political" && (
        <div className="mb-3 rounded-btn border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Political or contentious. No AI-drafted reply, by design. Write your own reply below, answer on YouTube, or dismiss.
        </div>
      )}

      {canReply && (
        <div className="mb-3 rounded-btn border border-line bg-bone/60 p-3">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <span className="font-medium text-ink">{c.category === "flag_political" ? "Your reply" : "Draft reply"}</span>
            <span>{c.category === "flag_political" ? "written by you, nothing is pre-filled" : "edit before posting"}</span>
            {c.category === "respond" && c.draftVoice && (
              <span className="rounded-full bg-white px-2 py-0.5 font-medium text-ink">{VOICE_LABELS[c.draftVoice]}</span>
            )}
          </div>
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            disabled={done || !!busy}
            rows={4}
            aria-label={c.category === "flag_political" ? "Your reply" : "Editable draft reply"}
            className="w-full resize-y rounded-btn border border-line bg-white p-2 text-sm text-ink shadow-inner focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink disabled:opacity-70"
          />
          {!done && (
            <div className="mt-1 flex flex-wrap justify-between gap-2 text-[11px] text-ink-muted">
              <span>{hasEmDash ? "Em dashes are converted to commas when posted." : ""}</span>
              <span>{draft.trim().length} characters · your edits are what gets posted</span>
            </div>
          )}
        </div>
      )}

      {outcome && (
        <div className={`mb-2 text-sm ${outcome.ok ? "font-medium text-ink-muted" : "text-red-800"}`} role="status">
          {outcome.message}
        </div>
      )}

      {!done && (
        <div className="flex flex-wrap items-center gap-2">
          {canReply && (
            <ActionButton primary busy={busy === "post_reply"} disabled={!!busy} onClick={() => onAct("post_reply")}>
              {c.category === "flag_political" ? "Post my reply" : "Approve and post"}
            </ActionButton>
          )}
          {isDelete && (
            <ActionButton danger busy={busy === "hide"} disabled={!!busy} onClick={() => onAct("hide")}>
              {c.category === "delete_spam" ? "Hide spam" : "Hide comment"}
            </ActionButton>
          )}
          {isDelete && block.eligible && (
            <ActionButton danger busy={busy === "hide_and_block"} disabled={!!busy} onClick={() => onAct("hide_and_block")}>
              Remove and block author
            </ActionButton>
          )}
          <ActionButton busy={busy === "dismiss"} disabled={!!busy} onClick={() => onAct("dismiss")}>
            {c.category === "ignore"
              ? "Mark reviewed"
              : c.category === "delete_spam"
                ? "Not spam"
                : c.category === "respond"
                  ? "No reply needed"
                  : "Dismiss"}
          </ActionButton>
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="ml-auto text-sm text-ink-muted underline hover:text-ink">
              Open on YouTube
            </a>
          )}
        </div>
      )}
      {isDelete && !done && block.eligible && (
        <p className="mt-2 text-[11px] text-ink-muted">
          {block.reason === "single_attack"
            ? "Unambiguous attack: block-eligible on the first instance."
            : "Repeat offender: block-eligible."}{" "}
          Hide is reversible. Remove and block is not, for the comment itself.
        </p>
      )}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  primary,
  danger,
  busy,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  busy?: boolean;
  disabled?: boolean;
}) {
  const base = "rounded-btn px-3 py-2 text-sm font-medium transition border disabled:opacity-60";
  const style = primary
    ? "bg-ink text-white border-ink hover:opacity-90"
    : danger
      ? "bg-white text-red-800 border-red-200 hover:bg-red-50"
      : "bg-white text-ink-muted border-line hover:bg-bone";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${style}`}>
      {busy ? "Working…" : children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-btn border border-line bg-white p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-[7px] px-2.5 py-1 text-sm transition ${
            value === o.value ? "bg-ink text-white" : "text-ink-muted hover:bg-bone"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
