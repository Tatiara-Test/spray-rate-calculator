# Tatiara Test release

This directory is a derived deployment copy of the approved local build. Only `site/` is published to `Tatiara-Test/spray-rate-calculator`.

The release is visibly labelled as a test edition, uses a test-only storage and service-worker cache namespace, disables legacy-origin migration, and contains no protected source snapshots or Sites project identifier.

Weather is shortcuts-only in this TEST channel. Open-Meteo and other forecast providers are disabled and are not part of the active or precached shell; saved links and recovery data remain local.

Work Notes is connected to the dedicated Tatiara Test AI Worker at `https://tatiara-work-ai-test.leximenexi.workers.dev`. The public release contains no OpenAI key or private access code. The access code is entered on the test phone, stored only in channel-scoped browser storage, excluded from app backups, and can be forgotten independently. The Worker retains a separate runtime kill switch so AI requests can be disabled without affecting manual Work Notes.

The v19 presentation release uses the `v19-2026-08-14-todo-language-pdf` cache generation. Installed test copies receive it through the app's explicit **Update now** flow, without changing their local records or installed-app identity.
