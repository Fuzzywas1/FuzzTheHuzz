# FuzzTheHuzz v6.0 Community + Customization Changelog

## Universal sidebar

- Replaced the old top navigation with one collapsible left sidebar shared by the protected Fuzz pages.
- Added links for Home, Chat, Fuzz AI, Apps, Tabs, Proxy, Settings, Feedback, Status, Account, and Admin.
- Added active-page highlighting, compact mode, mobile navigation, and route-aware overlay behavior for Tabs and Proxy.
- Added unread Chat badges and a notification center for direct messages and feedback updates.
- Kept the account and logout controls at the bottom of the sidebar.

## Fuzz Chat

- Added a permanent **Everyone** room available to every signed-in Fuzz account.
- Added one-to-one direct messages between users.
- Added live-style polling, online presence, typing indicators, unread counts, replies, reactions, edits, soft deletion, and image attachments.
- Added message reporting and a moderator report queue.
- Added user blocking, block-aware DM authorization, and an unblock list in Settings.
- Added one active DM conversation per user pair and server-side conversation membership checks.
- Added basic message burst protection: five messages per ten seconds per account.
- Limited messages to 2,000 characters and chat images to PNG, JPEG, or WebP files no larger than 8 MB.

## Personalization

- Rebuilt Settings as a real customization center instead of a redirect.
- Added private wallpaper uploads, HTTPS image URLs, fit, position, blur, and dark-overlay controls.
- Added accent color, surface opacity, corner radius, font scaling, spacing density, reduced motion, and sidebar mode.
- Added controls for showing or hiding Home quick links, bookmarks, and recent sites.
- Added a saved default page after sign-in.
- Synced settings through Supabase while retaining local cache for faster first paint.

## Feedback

- Added a dedicated Feedback page for bug reports, feature ideas, proxy issues, account problems, design feedback, and other requests.
- Added optional screenshots and safe diagnostic details.
- Added personal submission history, search, filters, status tracking, comments, and staff replies.
- Added staff controls for status, priority, assignment, and private internal notes.
- Added notifications when staff reply or change a submission's status.

## Data and storage

- Added `supabase/FUZZ_6_COMMUNITY_SCHEMA.sql`.
- Added tables for personalization, conversations, members, messages, reactions, typing, presence, blocks, reports, feedback, comments, and notifications.
- Added private Storage buckets for wallpapers, chat images, and feedback screenshots.
- Enabled Row Level Security and retained server-only service-role access.
- Added an expanded setup diagnostic that reports whether the Fuzz 6 modules are installed.

## Compatibility and stability

- Preserved Scramjet, Ultraviolet, Apps, Tabs, Fuzz AI, account management, status, and existing admin features.
- Added `/settings` as an alias for the existing `/c` route.
- Updated the login redirect to honor a user's saved default page unless an explicit `next` address is present.
- Updated the project audit to check the new pages, scripts, SQL migration, API markers, and required DOM hooks.
- Updated the release version to `6.0.0`.
