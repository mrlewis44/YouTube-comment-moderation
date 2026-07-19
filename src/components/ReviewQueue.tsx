"use client";

import { useMemo, useState } from "react";
import {
  CATEGORY_LABELS,
  CHANNELS,
  type Category,
  type ChannelKey,
  type DraftVoice,
} from "@/lib/domain";
import type { MockComment } from "@/lib/mock";

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

type Resolution = "posted" | "deleted" | "dismissed" | "blocked" | "flagged";

export function ReviewQueue({
  comments,
  channels,
}: {
  comments: MockComment[];
  channels: ChannelKey[];
  canModerate: boolean;
}) {
  const [channelFilter, setChannelFilter] = useState<ChannelKey | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [resolved, setResolved] = useState<Record<string, Resolution>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const filtered = useMemo(
    () =>
      comments.filter(
        (c) =>
          (channelFilter === "all" || c.channel === channelFilter) &&
          (categoryFilter === "all" || c.category === categoryFilter),
      ),
    [comments, channelFilter, categoryFilter],
  );

  const pendingCount = filtered.filter((c) => !resolved[c.id]).length;

  function resolve(id: string, how: Resolution) {
    setResolved((prev) => ({ ...prev, [id]: how }));
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
        <Segmented
          value={categoryFilter}
          onChange={(v) => setCategoryFilter(v as Category | "all")}
          options={[
            { value: "all", label: "All" },
            ...(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => ({
              value: c,
              label: CATEGORY_LABELS[c],
            })),
          ]}
        />
        <span className="ml-auto text-sm text-ink-muted">
          {pendingCount} pending
        </span>
      </div>

      <ul className="space-y-3">
        {filtered.map((c) => (
          <li key={c.id}>
            <CommentCard
              comment={c}
              resolution={resolved[c.id]}
              draft={drafts[c.id] ?? c.draftReply ?? ""}
              onDraftChange={(text) =>
                setDrafts((prev) => ({ ...prev, [c.id]: text }))
              }
              onResolve={(how) => resolve(c.id, how)}
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

function CommentCard({
  comment,
  resolution,
  draft,
  onDraftChange,
  onResolve,
}: {
  comment: MockComment;
  resolution?: Resolution;
  draft: string;
  onDraftChange: (text: string) => void;
  onResolve: (how: Resolution) => void;
}) {
  const c = comment;
  const isDelete = c.category === "delete_troll" || c.category === "delete_spam";
  // High-confidence unambiguous attack: block-eligible on comment #1 (SPEC 5).
  const blockEligible =
    c.category === "delete_troll" &&
    (c.confidence >= 0.85 || (c.authorOffenseCount ?? 0) >= 3);

  return (
    <div
      className={`rounded-2xl border bg-white p-4 shadow-sm transition ${
        resolution ? "border-line opacity-60" : "border-line"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`rounded-full px-2 py-0.5 font-medium ${CATEGORY_STYLES[c.category]}`}
        >
          {CATEGORY_LABELS[c.category]}
        </span>
        <span className="text-ink-muted">
          {Math.round(c.confidence * 100)}% confidence
        </span>
        <span className="text-ink-muted">· {CHANNELS[c.channel].displayName}</span>
        {c.clusterWith && c.clusterWith.length > 0 && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-800">
            spam cluster of {c.clusterWith.length + 1}
          </span>
        )}
        {(c.authorOffenseCount ?? 0) > 1 && (
          <span className="rounded-full bg-orange-50 px-2 py-0.5 text-orange-800">
            repeat author · {c.authorOffenseCount} flags
          </span>
        )}
      </div>

      <div className="mb-1 text-sm font-medium text-ink">{c.author}</div>
      <div className="mb-2 text-xs text-ink-muted">on “{c.videoTitle}”</div>
      <p className="mb-3 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
        {c.text}
      </p>

      {c.category === "respond" && (
        <div className="mb-3 rounded-btn border border-line bg-bone/60 p-3">
          <div className="mb-1.5 flex items-center gap-2 text-xs text-ink-muted">
            <span>Draft reply</span>
            {c.draftVoice && (
              <span className="rounded-full bg-white px-2 py-0.5 font-medium text-ink">
                {VOICE_LABELS[c.draftVoice]}
              </span>
            )}
          </div>
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            disabled={!!resolution}
            rows={4}
            className="w-full resize-y rounded-btn border border-line bg-white p-2 text-sm text-ink focus:border-ink focus:outline-none disabled:opacity-70"
          />
        </div>
      )}

      {c.category === "flag_political" && (
        <div className="mb-3 rounded-btn border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Political or contentious. No auto-drafted reply, by design. Answer
          personally or dismiss.
        </div>
      )}

      {resolution ? (
        <div className="text-sm font-medium text-ink-muted">
          {resolutionLabel(resolution)}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {c.category === "respond" && (
            <ActionButton primary onClick={() => onResolve("posted")}>
              Approve and post
            </ActionButton>
          )}
          {isDelete && (
            <ActionButton danger onClick={() => onResolve("deleted")}>
              {c.category === "delete_spam" ? "Hide (reject)" : "Delete"}
            </ActionButton>
          )}
          {blockEligible && (
            <ActionButton danger onClick={() => onResolve("blocked")}>
              Delete and block author
            </ActionButton>
          )}
          {c.category === "flag_political" && (
            <ActionButton onClick={() => onResolve("flagged")}>
              Mark for personal reply
            </ActionButton>
          )}
          <ActionButton onClick={() => onResolve("dismissed")}>
            {c.category === "ignore" ? "Mark reviewed" : "Dismiss"}
          </ActionButton>
        </div>
      )}
    </div>
  );
}

function resolutionLabel(how: Resolution): string {
  switch (how) {
    case "posted":
      return "Reply approved and posted (demo, no live post yet).";
    case "deleted":
      return "Comment hidden (demo, reversible in the live app).";
    case "blocked":
      return "Comment removed and author blocked (demo).";
    case "flagged":
      return "Flagged for a personal reply.";
    case "dismissed":
      return "Dismissed and marked reviewed.";
  }
}

function ActionButton({
  children,
  onClick,
  primary,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  const base =
    "rounded-btn px-3 py-2 text-sm font-medium transition border";
  const style = primary
    ? "bg-ink text-white border-ink hover:opacity-90"
    : danger
      ? "bg-white text-red-800 border-red-200 hover:bg-red-50"
      : "bg-white text-ink-muted border-line hover:bg-bone";
  return (
    <button type="button" onClick={onClick} className={`${base} ${style}`}>
      {children}
    </button>
  );
}

function Segmented<T extends string>({
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
            value === o.value
              ? "bg-ink text-white"
              : "text-ink-muted hover:bg-bone"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
