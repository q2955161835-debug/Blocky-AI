---
name: minimax-h3-local
description: Use when the user wants MiniMax H3 audiovisual video generation on this machine from text, a first frame, a last frame, first and last frames, or supported reference assets.
---

# MiniMax H3 Local Video

Route the request to an existing local H3 workflow, write the prompt with MiniMax's official guidance, then execute through `comfy-local`.

**REQUIRED SUB-SKILL:** Use `comfyui-local` for preflight, workflow slots, submission, job continuity, paid/cloud boundaries, and output retrieval.

## Preflight and mode routing

Run `scripts/check_h3_setup.py --profile references/local-routing.json`. Read [references/local-routing.json](references/local-routing.json) for exact workflow and model paths.

| User input | Mode | Local workflow |
| --- | --- | --- |
| Text only | T2VA | saved text-to-video workflow |
| First frame | I2VA | saved frame-conditioned workflow; set first frame only |
| Last frame | L2VA | same workflow; set last frame only |
| First + last frames | FL2VA | same workflow; set both frames |
| Character replacement references | Ref2VA character replacement | saved Plan v2 workflow |

“Make this image move” means I2VA. “Keep this subject/identity/style as reference” means Ref2VA. If that distinction is unclear, ask because it changes the conditioning path. General Ref2VA is not yet represented by a verified saved local workflow; do not claim it is ready or substitute the character-replacement graph.

Use the standard workflow by default. Select the Spectrum variant only when the user explicitly prioritizes that acceleration path. Preserve workflow defaults unless the user requests a parameter change; do not hard-code node IDs, sampler chains, duration, resolution, or steps.

## Write the H3 prompt

Read [references/official-h3-prompt-writing.md](references/official-h3-prompt-writing.md), then:

- T2VA/I2VA/L2VA/FL2VA: read [references/base-en.txt](references/base-en.txt) and keep `integrated_multimodal_description`, `overall_soundscape`, `non_diegetic_music` in that order.
- Ref2VA character replacement: read [references/ref-en.txt](references/ref-en.txt) and keep its six official sections and stable reference labels.

Write section prose in English while preserving requested dialogue, lyrics, and visible text in their original language. Match the requested 4–15 second timeline and describe camera, action, dialogue, effects, ambience, and music concretely.

## Execute and verify

Discover notes and slots from the chosen saved workflow, stage local input assets, set only discovered slots non-destructively, validate, and submit asynchronously with `confirm_spend=False`. Retain one `prompt_id`; a timeout is not permission to submit again. After terminal success, fetch the MP4 and report its absolute path, size, duration, resolution, frame rate, audio/video streams, and representative frame checks.

On terminal generation failure, diagnose before retrying and allow at most one deliberate regeneration. Retrieval failures retry retrieval only. Never silently change mode, use a MiniMax cloud/API node, or fall back to another video model.

Source pinning is recorded in [references/provenance.json](references/provenance.json).
