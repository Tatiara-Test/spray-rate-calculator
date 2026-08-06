# Tatiara Test release

This directory is a derived deployment copy of the approved local build. Only `site/` is published to `Tatiara-Test/spray-rate-calculator`.

The release is visibly labelled as a test edition, uses a test-only storage and service-worker cache namespace, disables legacy-origin migration, and contains no protected source snapshots or Sites project identifier.

Open-Meteo is enabled only in this TEST channel for evaluation. It is labelled as model forecast data with attribution and is not approved for worker production. The production-ready template remains disabled by default until a suitable commercial licence or alternative source is approved.

Work Notes is connected to the dedicated Tatiara Test AI Worker at `https://tatiara-work-ai-test.leximenexi.workers.dev`. The public release contains no OpenAI key or private access code. The access code is entered on the test phone, stored only in channel-scoped browser storage, excluded from app backups, and can be forgotten independently. The Worker retains a separate runtime kill switch so AI requests can be disabled without affecting manual Work Notes.

Installed test copies use the `v10-2026-08-07-ai-live-config` cache generation and receive this configuration through the app's explicit **Update now** flow.
