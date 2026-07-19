// Google Chat notifications for high-priority opportunity comments (SPEC 8a).
//
// Fires when a comment is scored as a loan or real estate opportunity above the
// threshold. Uses a Google Chat incoming webhook (a space-scoped URL you paste
// into GOOGLE_CHAT_WEBHOOK_URL). No OAuth needed for incoming webhooks. If the
// URL is unset, notifications are skipped silently so the rest of the pipeline
// is unaffected.

import { ENV } from "./env";
import {
  CHANNELS,
  OPPORTUNITY_LABELS,
  isNotifiableOpportunity,
  type ChannelKey,
  type OpportunityType,
} from "./domain";

export type OpportunityNotice = {
  channel: ChannelKey;
  videoId: string;
  videoTitle?: string | null;
  author: string;
  authorChannelUrl?: string | null;
  text: string;
  platformCommentId: string;
  opportunityType: OpportunityType;
  opportunityScore: number;
};

/** Deep link to the comment on YouTube (opens the thread on the video). */
export function commentUrl(videoId: string, commentId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(
    videoId,
  )}&lc=${encodeURIComponent(commentId)}`;
}

/**
 * Build the Google Chat cardsV2 payload. Exported so it can be unit-checked and
 * previewed without hitting the network.
 */
export function buildOpportunityCard(n: OpportunityNotice) {
  const title =
    n.opportunityType === "loan"
      ? "Possible loan opportunity"
      : "Possible real estate opportunity";
  const channelName = CHANNELS[n.channel].displayName;
  const score = Math.round(n.opportunityScore * 100);

  return {
    text: `${title} on ${channelName} (${score}% signal)`,
    cardsV2: [
      {
        cardId: `opp-${n.platformCommentId}`,
        card: {
          header: {
            title,
            subtitle: `${channelName} · ${score}% signal`,
          },
          sections: [
            {
              widgets: [
                {
                  decoratedText: {
                    topLabel: "From",
                    text: n.author,
                  },
                },
                n.videoTitle
                  ? {
                      decoratedText: {
                        topLabel: "Video",
                        text: n.videoTitle,
                      },
                    }
                  : null,
                {
                  textParagraph: {
                    text: n.text,
                  },
                },
                {
                  buttonList: {
                    buttons: [
                      {
                        text: "Open comment",
                        onClick: {
                          openLink: {
                            url: commentUrl(n.videoId, n.platformCommentId),
                          },
                        },
                      },
                    ],
                  },
                },
              ].filter(Boolean),
            },
          ],
        },
      },
    ],
  };
}

/**
 * Send the notification if the comment clears the opportunity threshold and a
 * webhook is configured. Returns whether a notification was actually sent.
 * Never throws into the caller: a notification failure must not break ingestion.
 */
export async function notifyOpportunity(
  n: OpportunityNotice,
): Promise<{ sent: boolean; reason?: string }> {
  if (!isNotifiableOpportunity(n.opportunityType, n.opportunityScore)) {
    return { sent: false, reason: "below threshold" };
  }
  if (!ENV.googleChatWebhookUrl) {
    return { sent: false, reason: "no webhook configured" };
  }
  try {
    const res = await fetch(ENV.googleChatWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(buildOpportunityCard(n)),
    });
    if (!res.ok) {
      return { sent: false, reason: `chat webhook ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : "send failed" };
  }
}

export { OPPORTUNITY_LABELS };
