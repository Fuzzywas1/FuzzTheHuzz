# Interstellar v6 review for Novaris 8.2.0

Reviewed the actual source at commit ed6bf5230c472a7782b3bf9f6a466a5361f48090, not the moving latest branch. No upstream code was merged in this update: the implemented changes complete Rammerhead's UI coverage. Novaris keeps its own version, authentication, accounts, control panel, routing, Games, fullscreen and loaders.

Source: https://github.com/UseInterstellar/Interstellar/tree/ed6bf5230c472a7782b3bf9f6a466a5361f48090

## Recommended next changes

1. Review URL normalization and service-worker first-load behavior together. Novaris currently normalizes text into URLs/searches, registers Scramjet with an activation wait, and registers UV separately. Scramjet's wait currently resolves after a timeout without verifying activation; UV registration alone does not guarantee activation. Add explicit readiness/error handling with fresh-profile, failed-install and interrupted-load tests. Do not copy upstream's routes/scopes: Novaris uses different ones.
2. Adapt the `_top` link/form fix. Upstream tabs intercept these targets and keep navigation inside the tab system; it also retargets scripted form submissions. This could help sites whose links currently do nothing under iframe sandboxing. Test GET and POST forms, submitter overrides, keyboard navigation and each engine. Rammerhead is cross-origin, so a parent-page listener cannot simply inspect its document. Never fix this by allowing arbitrary top-level navigation.
3. Add measured request-rate limits to expensive public/API routes. Novaris already has account usage enforcement and a chat-specific rate limiter; that is not equivalent to burst protection everywhere. Upstream's example uses 100 requests/minute for selected routes and 50/minute for game assets. Blindly copying those numbers can throttle game loading or users behind shared IPs. Set trusted-proxy handling and per-account/IP policies deliberately, and verify WebSocket handling separately.
4. Serve Ultraviolet from a pinned package after a compatibility comparison. Upstream specifies UV ^3.2.10, while Novaris serves vendored UV files from its existing mathematics asset directory. Preserve Novaris's /a/ scope and config; verify the vendored build before replacing it. Scramjet already comes from node_modules in Novaris.
5. Consider build metadata in Account/Settings. Use Novaris's package version plus an explicit release/build date, including a fallback for ZIP deployments without .git. Never display Interstellar v6 as Novaris's own version.

## Changes to assess selectively

| Upstream item | Novaris recommendation |
| --- | --- |
| Updated Scramjet/default engine | This exact release specifies ^1.1.0. Novaris already uses the 1.1.0 release artifact and defaults to Scramjet. This is not evidence of a newer engine to install. |
| Games caching | src/games.js caches proxied /gh-games assets for a year with immutable headers; this is not simply caching the UI's games.js file. Novaris already has a remote asset cache and admin cache clearing. Use immutable caching only for versioned assets, or game fixes can remain stale. |
| Broken game links/new game mirror | Compare the catalogs and test individual affected games before importing links. Do not overwrite Novaris's library, favorites, launchers or local games. |
| Local particles | Useful if an active page still depends on a third-party CDN. Check actual script references first; keep Novaris's space animations and reduced-motion behavior. |
| Theme flash prevention | Worth testing on a cold load; adapt early application of Novaris's existing preferences, rather than transplanting upstream's theme storage/stylesheet system. |
| CSS minification | Optional after behavior changes; add a reproducible build and asset validation before shipping minified output. |
| Cursor effects/new themes | Optional user-facing features, not required fixes. They change appearance and should be a separate design decision. |
| Removing Dynamic/Masqr | Audit remaining references before removing files. Novaris already clears its legacy Dynamic override when selecting an engine, but that alone does not prove all legacy assets are unused. |

## Do not merge wholesale

- The theme overhaul, page rearrangements, navbar changes and renamed CSS classes would conflict with preserving Novaris's design.
- Removing the Tabs button would remove an existing Novaris navigation entry.
- Moving server code into /src is a separate refactor, not a required compatibility fix. Upstream's server is not a replacement for Novaris's account/admin backend.
- Whole-application obfuscation, randomized routes and an obfuscated address bar complicate debugging and deployment. They do not replace authentication or access controls. Novaris also must keep its existing loaders, routes and readable error handling working.
- Obfuscating or adding analytics is not needed for this feature.
- Removing all cache/version query strings needs a replacement cache-invalidation strategy; it should not be copied casually.

## Source files inspected

- package.json: https://github.com/UseInterstellar/Interstellar/blob/ed6bf5230c472a7782b3bf9f6a466a5361f48090/package.json
- Server and limits: https://github.com/UseInterstellar/Interstellar/blob/ed6bf5230c472a7782b3bf9f6a466a5361f48090/src/server.js
- Games caching: https://github.com/UseInterstellar/Interstellar/blob/ed6bf5230c472a7782b3bf9f6a466a5361f48090/src/games.js
- Tabs behavior: https://github.com/UseInterstellar/Interstellar/blob/ed6bf5230c472a7782b3bf9f6a466a5361f48090/static/assets/js/tabs.js
- Also inspected src/version.js, src/build.js, static/assets/js/settings.js, launcher.js, main.js and static/sw.js at the same commit. No live deployment or performance comparison was made.
