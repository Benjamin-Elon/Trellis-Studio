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
