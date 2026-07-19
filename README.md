# Comment Copilot

YouTube comment triage and response-drafting tool for The Educated HomeBuyer and
Josh Lewis's personal channel. Polls both channels, categorizes comments with
Claude (respond / ignore / delete_troll / delete_spam / flag_political), drafts
replies in the TEHB voice, and routes everything through a human-approval queue
before anything posts or deletes.

**Start here:** [`SPEC.md`](./SPEC.md) is the build spec. It is the thing to
follow. It covers auth, data model, the categorization taxonomy, voice rules for
reply drafting, staged autonomy for spam auto-actioning, the MVP feature list,
and the open items to confirm before launch.

This repo holds the spec only right now. The app is not built yet.
