---
name: adding-methods
description: Use when adding a new function, method, or class to this repo, or when editing an existing one so that its behaviour, signature, or responsibilities change - including "add a helper", "extract this", "make X also do Y", and new CLI commands or API endpoints.
---

# Adding or changing a method

Every method in this repo has one home and one job. Before you write it, decide the home; while you write it, hold the job to one.

## Step 1 — Read the map

Read [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) before writing the method. It states what each file is for, which layer a method belongs in, and the naming conventions. Do not rely on the file you happen to have open.

## Step 2 — Place it

Name the method, then pick its home from its name and its dependencies:

| The method... | Lives in |
|---|---|
| touches `fs` (read, write, scan, exists) | `lib/utils/fsUtils.js` |
| makes an HTTP request to Silverfin | `lib/api/sfApi.js` |
| knows a template type's config keys or folder layout | the matching `lib/templates/*.js` class |
| produces a user-facing error message | `lib/utils/errorUtils.js` |
| validates a CLI option or prompts the user | `lib/cli/utils.js` |
| sequences an API call plus a disk write | `index.js` |
| parses or transforms data with no I/O | the relevant `lib/utils/*.js` |

Two checks before you commit to a location:

- **Does it already exist?** Grep `lib/utils/` and the layer you picked. A near-duplicate helper is a call, not a new method.
- **Would it skip a layer?** `bin/cli.js` must not call `lib/api/`; `lib/api/` must not touch `fs`. If your method forces a skip, it is in the wrong place.

If the method fits nowhere in the table, say so and propose where it should go before writing it. A new home is a decision for the user, not a default.

## Step 3 — One responsibility

The method does one thing, at one level of abstraction, for one reason to change.

Three tests it must pass:

1. **The name test.** You can name it without "and", "then", "Or", or a vague noun (`handle`, `process`, `manage`, `doStuff`). If the honest name needs "and", it is two methods.
2. **The layer test.** It does not both decide and perform I/O. Deciding *which* template to fetch and *fetching* it are separate methods.
3. **The reason test.** You can state one change to the product that would require editing it. Two unrelated reasons means split it.

When you split, the caller keeps the sequencing and each new method keeps one step.

A split usually produces a **private helper**: a small unexported function whose only caller is the file it came out of. Leave it there, next to that caller. The Step 2 table places methods other files will reach for; it does not evict a helper from the only file that uses it. Splitting for one responsibility and keeping the pieces together is not a failed split.

Move a helper out only when one of these is true:

- a second file needs it — then it goes to the home its own row gives it, and gets exported
- it is generic (it knows nothing about the subject of the file it sits in) **and** you can name the other caller that wants it. "Someone might" is not a caller
- the public function's tests cannot reach one of its branches. That means it is a unit in its own right: move it, export it, and test it directly

"It has no test of its own" is not a reason to move it. A private helper is tested through the function that calls it.

Applies equally to edits: if you are asked to make an existing method "also" do something, the answer is a second method plus a caller, not a longer method. Say that in your response rather than silently growing the function.

## Step 4 — Report

State, in one line each:

- where you put it and which row of the table put it there
- the one responsibility it has
- anything you split out, and where that went — for a private helper you kept in the same file, say so and say why it stayed

Then add the test in the mirrored `tests/` path, and run `npx jest <path>` before claiming it works.

## Red flags

- "I'll just add it to the file I'm already in" — said about a method other files will call
- Exporting a private helper only so a test can reach it
- "It's only a few lines, no need to check the doc"
- A new method with `fs` and `axios` both in scope
- A parameter named `options` that switches behaviour between two unrelated jobs
- A boolean parameter that selects which of two things the method does — that is two methods
- Editing an exported method's signature without checking its callers
