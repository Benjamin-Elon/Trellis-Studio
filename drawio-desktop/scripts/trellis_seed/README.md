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

On Windows, open **Settings and credentials → API credentials** in the seeder <!-- CHANGE -->
and enter the OpenAI and FoodData Central keys at the hidden prompts. Keys live <!-- NEW -->
in Windows Credential Manager as `Trellis/Seeder/OpenAI` and <!-- NEW -->
`Trellis/Seeder/FoodDataCentral`, for your Windows account on this computer. <!-- NEW -->
Windows ignores API keys in environment variables and JSON settings. Missing FDC <!-- NEW -->
credentials use `DEMO_KEY` with one shared-quota warning per session; storage <!-- NEW -->
errors require repair rather than silently selecting demo access. <!-- NEW -->

Set nonsecret model options in the shell before launching the menu: <!-- CHANGE -->

```powershell
$env:OPENAI_MODEL = "gpt-5.5"
$env:OPENAI_REASONING_EFFORT = "high"
```

The default model is `gpt-5.5` and the default reasoning effort is `high`.
Do not put API keys in `trellis_seed.config.json`.

On non-Windows platforms, `OPENAI_API_KEY` and `FDC_API_KEY` environment variables <!-- NEW -->
remain supported. Use your platform's secret manager or an interactive shell; <!-- NEW -->
never commit keys or put real values in scripts or command-line arguments. <!-- NEW -->

**Desktop profile keys are separate:** signed-in users open **Extras → API keys…** <!-- NEW -->
to save, replace, or remove OpenAI and FoodData Central keys for their current <!-- NEW -->
Trellis profile. These keys use OS encryption and remain private to this device; <!-- NEW -->
they are excluded from garden exports, identity pairing, and synchronization. <!-- NEW -->
The standalone seeder never reads them. Saved values are never returned to the <!-- NEW -->
dialog, and saving a key does not call a provider or verify API permissions. <!-- NEW -->

After reinstalling Windows, changing Windows accounts, or moving to another <!-- NEW -->
computer, enter keys again. For a damaged entry, remove it and save a replacement. <!-- NEW -->
If OS encryption is unavailable, repair the Windows session or OS secret store; <!-- NEW -->
there is no plaintext fallback. Existing applications may retain old environment <!-- NEW -->
keys until restarted. Both encryption systems protect data at rest; another <!-- NEW -->
process running as your Windows account can still access OS-protected secrets. <!-- NEW -->

Local tests:

```powershell
npm run test:trellis-seed
```

Live tests are available from the interactive menu and require network access
plus an OpenAI API key.

## Growth-stage yields <!-- CHANGE -->

`PlantGrowthStages.yield_ratio` multiplies the resolved variety yield (or plant <!-- CHANGE -->
yield when no variety override exists). It is total stage-specific kilograms per <!-- CHANGE -->
plant divided by mature kilograms per plant over the corresponding harvest window. <!-- CHANGE -->
For example, a 2.5 kg/plant variety grown at ratio 0.2 supplies 0.5 kg/plant. <!-- CHANGE -->
New model responses require a finite positive ratio for each stage; values above <!-- CHANGE -->
1 are allowed. Generated Mature stages use 1. Ratios use supplied sources first, <!-- CHANGE -->
with horticultural estimates when sources are incomplete; timing and spacing <!-- CHANGE -->
ratios do not determine yield. Generated values remain projections to review. <!-- CHANGE -->

Legacy seed artifacts may omit `yield_ratio`. Omission preserves an existing <!-- CHANGE -->
stage's ratio during updates; new rows default to 1. An explicit null, zero, <!-- CHANGE -->
negative, nonnumeric, or nonfinite ratio fails validation. An explicit valid <!-- CHANGE -->
ratio, including 1, updates the stored value through the normal reviewed Apply <!-- CHANGE -->
workflow. Diff previews use the migration default of 1 for old databases lacking <!-- CHANGE -->
the column. <!-- CHANGE -->

The additive migration preserves existing rows and identifiers. It cannot infer <!-- CHANGE -->
agronomic yields: old non-Mature stages start at 1 and can overestimate supply <!-- CHANGE -->
until their ratios are reviewed. The schema upgrade does not regenerate crop data. <!-- CHANGE -->
