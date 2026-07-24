TABS LAYOUT + HOME BUTTON FIX
=============================

Fixes
-----
- Removes the blank white strip above proxied websites.
- Forces every proxy iframe to fill the entire browser content area.
- Keeps the frame clipped below the tab bar and address toolbar.
- Changes the Home button so it exits Tabs and returns to the main Fuzz homepage.
- Preserves Scramjet's /scram/scramjet.all.js client file.
- Bumps CSS and JavaScript versions to prevent stale browser cache.

Install
-------
1. Upload this ZIP beside index.js.
2. Extract it from the project root:

   unzip -o Fuzz-Control-tabs-layout-home-fix.zip

3. Check the updated JavaScript:

   node --check static/assets/js/t3.js

4. Restart:

   npm start

5. Open /d and hard-refresh:

   Ctrl + Shift + R

The Home button should now go directly to / instead of loading Home inside a tab.
