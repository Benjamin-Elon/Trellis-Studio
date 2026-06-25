# Trellis Seed CLI

Run from `drawio-desktop`:

```powershell
npm run trellis:seed
```

The menu loads structured JSON input, generates reviewable run folders under
`trellis_seed_runs`, validates generated artifacts, previews database diffs,
backs up `trellis_database/Trellis_database.sqlite`, auto-runs idempotent schema
migrations, and applies validated rows after a yes/no confirmation.

Install the OpenAI SDK before generation:

```powershell
python -m pip install -r requirements-trellis-seed.txt
```

Set OpenAI credentials in the shell before launching the menu:

```powershell
$env:OPENAI_API_KEY = "..."
$env:OPENAI_MODEL = "gpt-5.5"
$env:OPENAI_REASONING_EFFORT = "high"
```

The default model is `gpt-5.5` and the default reasoning effort is `high`.
Do not put API keys in `trellis_seed.config.json`.

Local tests:

```powershell
npm run test:trellis-seed
```

Live tests are available from the interactive menu and require network access
plus an OpenAI API key.
