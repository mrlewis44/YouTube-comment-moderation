// Sample comments for the review-queue UI before live YouTube ingestion is
// wired. These are calibrated to the taxonomy examples in SPEC Section 5 so the
// queue demonstrates every category and the two draft voices. Not real data.

import type { Category, ChannelKey, DraftVoice, ReviewStatus } from "./domain";

export type MockComment = {
  id: string;
  channel: ChannelKey;
  videoTitle: string;
  author: string;
  text: string;
  likeCount: number;
  publishedAt: string;
  // Pre-filled triage so the UI has something to render. In the live app these
  // come from /api/categorize and /api/draft-reply.
  category: Category;
  confidence: number;
  draftReply?: string;
  draftVoice?: DraftVoice;
  status: ReviewStatus;
  // For spam clusters (SPEC Section 5): sibling comment ids in the same unit.
  clusterWith?: string[];
  authorOffenseCount?: number;
};

export const MOCK_COMMENTS: MockComment[] = [
  {
    id: "c1",
    channel: "tehb",
    videoTitle: "Is the new housing policy actually good for buyers?",
    author: "@growthminded",
    text: "One thing nobody mentions is the out of state depreciation angle. If you buy a rental across state lines the tax treatment on depreciation recapture can wipe out the gain you think you are getting. Would love your take.",
    likeCount: 14,
    publishedAt: "2026-07-18T15:04:00Z",
    category: "respond",
    confidence: 0.82,
    draftReply:
      "Depreciation recapture is real and it catches people who only ran the appreciation math. It is taxed at up to 25 percent on the portion you depreciated, per IRS Section 1250, and yes it applies whether the rental is in state or out of state. The out of state part mostly adds a second state return, not a different recapture rule. If you want to pressure test a specific scenario, that is exactly the kind of thing we map out on a Roadmap conversation.",
    draftVoice: "josh",
    status: "pending",
  },
  {
    id: "c2",
    channel: "tehb",
    videoTitle: "FHA vs Conventional in a high cost market",
    author: "@firsttimebuyer_sd",
    text: "Wait, so you're saying FHA can actually be cheaper than conventional even with good credit? My loan officer told me FHA is only for people who can't qualify otherwise.",
    likeCount: 6,
    publishedAt: "2026-07-18T18:22:00Z",
    category: "respond",
    confidence: 0.88,
    draftReply:
      "That is a common thing to hear and it is not the full picture. FHA and conventional are different tools for different jobs. In a high cost market FHA often has a lower base rate, so even with strong credit the payment can come out lower once you put the two side by side. The only way to know is to see both scenarios on paper, same price, same down payment, and compare the total cost. Do not rule either one out before you have seen the comparison.",
    draftVoice: "josh",
    status: "pending",
  },
  {
    id: "c3",
    channel: "tehb",
    videoTitle: "How to make an offer that actually gets accepted",
    author: "@housinghunterOC",
    text: "We keep losing out. Been looking in three counties for 8 months and nothing sticks. Are we doing something wrong?",
    likeCount: 3,
    publishedAt: "2026-07-17T12:10:00Z",
    category: "respond",
    confidence: 0.79,
    draftReply:
      "Eight months across three counties is usually the problem right there. When you spread across that many markets you are never the most prepared buyer in any one of them. Start with the end in mind, pick the one area you actually want to be in, and work outward from there only if the price point forces it. Focus tends to fix the losing streak faster than a bigger search does, right?",
    draftVoice: "jeb",
    status: "pending",
  },
  {
    id: "c4",
    channel: "tehb",
    videoTitle: "Why rates aren't the whole story",
    author: "@marketwatcher22",
    text: "Good information.",
    likeCount: 0,
    publishedAt: "2026-07-18T09:00:00Z",
    category: "ignore",
    confidence: 0.95,
    status: "pending",
  },
  {
    id: "c5",
    channel: "tehb",
    videoTitle: "Why rates aren't the whole story",
    author: "@anoncritic",
    text: "yall are genuinely idiots and have no clue what youre talking about",
    likeCount: 0,
    publishedAt: "2026-07-18T09:32:00Z",
    category: "delete_troll",
    confidence: 0.91,
    status: "pending",
    authorOffenseCount: 1,
  },
  {
    id: "c6",
    channel: "tehb",
    videoTitle: "Housing market update July 2026",
    author: "@blunt_take",
    text: "This take is lazy and you know it.",
    likeCount: 1,
    publishedAt: "2026-07-18T10:15:00Z",
    category: "delete_troll",
    confidence: 0.54,
    status: "pending",
    authorOffenseCount: 2,
  },
  {
    id: "c7",
    channel: "tehb",
    videoTitle: "Housing market update July 2026",
    author: "@cryptoWealthGuru",
    text: "I never believed in trading until Mrs. Amanda Reyes changed my life. Invested 5k and got 62k in three weeks. Forever grateful!",
    likeCount: 0,
    publishedAt: "2026-07-18T11:01:00Z",
    category: "delete_spam",
    confidence: 0.97,
    status: "pending",
    clusterWith: ["c8", "c9"],
  },
  {
    id: "c8",
    channel: "tehb",
    videoTitle: "Housing market update July 2026",
    author: "@lindaK_invests",
    text: "Wow is this the same Amanda Reyes my colleague keeps talking about? She is the real deal.",
    likeCount: 0,
    publishedAt: "2026-07-18T11:04:00Z",
    category: "delete_spam",
    confidence: 0.96,
    status: "pending",
    clusterWith: ["c7", "c9"],
  },
  {
    id: "c9",
    channel: "josh",
    videoTitle: "My honest take on the 2026 rate outlook",
    author: "@hendersonlocal",
    text: "Henderson Nevada, 250,000, three hour drive to coast",
    likeCount: 0,
    publishedAt: "2026-07-18T13:40:00Z",
    category: "delete_spam",
    confidence: 0.72,
    status: "pending",
  },
  {
    id: "c10",
    channel: "tehb",
    videoTitle: "Is the new housing policy actually good for buyers?",
    author: "@fedup_voter",
    text: "This is what happens when you let one party run everything into the ground. Wake up people.",
    likeCount: 9,
    publishedAt: "2026-07-18T16:20:00Z",
    category: "flag_political",
    confidence: 0.9,
    status: "pending",
  },
  {
    id: "c11",
    channel: "josh",
    videoTitle: "My honest take on the 2026 rate outlook",
    author: "@refi_curious",
    text: "My current lender is pitching a refi where I skip two payments. Sounds great but is there a catch?",
    likeCount: 4,
    publishedAt: "2026-07-18T17:45:00Z",
    category: "respond",
    confidence: 0.85,
    draftReply:
      "There is a catch and it is worth understanding before you sign. You never actually skip a payment. Those two payments get financed into the new loan balance, so your loan grows by roughly that amount plus the interest and escrow they roll in. It can make sense in specific cases, but the honest version is you are borrowing those payments, not skipping them. Ask them to show you the new loan balance next to your current one and you will see it.",
    draftVoice: "josh",
    status: "pending",
  },
];
