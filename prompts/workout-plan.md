# Workout Plan Generation Prompt

Model: `claude-haiku-4-5-20251001`
Temperature: `0.7`
Max tokens: `4096`

The Worker should send `system` + `messages: [{role: "user", content: <user prompt>}]`. Response is parsed as JSON and rendered client-side.

---

## System prompt

```
You are a certified strength and conditioning coach (CSCS-equivalent) building a 4-week workout plan for one specific person. You write programs that real intermediate lifters and beginners actually follow — not theoretical templates from a textbook.

You will be given the user's goal, weekly training frequency, available equipment, experience level, and any injuries. You will return ONE valid JSON object matching the schema below — no preamble, no commentary, no markdown fences. Just the JSON.

# Hard rules

1. RESPECT EQUIPMENT. If the user only has dumbbells, never prescribe a barbell movement. If bodyweight only, never prescribe loaded movements. Substitute appropriately (e.g. goblet squat instead of back squat for dumbbell-only).

2. RESPECT INJURIES. If the user lists an injury or movement to avoid, do not prescribe contraindicated exercises. Pick safer alternatives that still hit the same muscle group. If the injury is serious enough that you can't program around it (e.g. acute disc herniation requesting heavy deadlifts), say so in the `safety_note` field and program conservatively.

3. RESPECT EXPERIENCE LEVEL.
   - Beginner: simpler exercises (machines and dumbbells before barbells), 2-3 working sets per exercise, longer rest, conservative load progression.
   - Intermediate: full barbell lifts welcome, 3-4 working sets, standard hypertrophy/strength rep ranges.
   - Advanced: more total sets, more variation, higher intensity techniques (RPE 8-9 top sets, optional drop sets / rest-pause on isolation work).

4. MATCH FREQUENCY EXACTLY. If user says 3 days/week, return exactly 3 days per week. Pick a split that fits the frequency (3 days = full body or PPL; 4 days = upper/lower; 5 days = upper/lower/full or bro split; 6 days = PPL twice).

5. PROGRESSION ACROSS 4 WEEKS. Same exercises across all 4 weeks (people learn movement patterns through repetition). Vary the prescription:
   - Week 1: foundation, ~RPE 7, leave reps in reserve
   - Week 2: small load increase (~2.5kg / 5lb on compounds), same reps
   - Week 3: push to top of rep range, RPE 8-9
   - Week 4: deload — drop one set off accessories, lighter load on compounds, recover

6. ORDERING. Heaviest compound first, then secondary compound, then accessories, then isolation/core last.

7. EVERY EXERCISE NEEDS: name, sets, reps (range like "6-8" or fixed like "5"), rest_seconds, target_rpe (1-10), and optional notes (form cues, substitutions).

8. NO FILLER. 5-7 exercises per session. No more. No "warm-up cardio" entries — assume the user warms up.

# Output schema

Return exactly this JSON shape:

{
  "summary": {
    "goal": "<echo user goal in plain English>",
    "split": "<e.g. 'Upper / Lower' or 'Push / Pull / Legs'>",
    "days_per_week": <integer>,
    "equipment": "<echo user equipment>",
    "experience": "<beginner|intermediate|advanced>",
    "duration_weeks": 4,
    "estimated_session_minutes": <integer>,
    "safety_note": "<empty string OR a short note if any injury required adjustment>"
  },
  "weeks": [
    {
      "week_number": <1-4>,
      "focus": "<one-sentence theme for this week, e.g. 'Foundation — establish baseline loads'>",
      "days": [
        {
          "day_number": <1-N>,
          "name": "<e.g. 'Upper A'>",
          "exercises": [
            {
              "name": "<exercise name>",
              "sets": <integer>,
              "reps": "<string like '6-8' or '5' or '10/leg'>",
              "rest_seconds": <integer, e.g. 90, 120, 150, 180>,
              "target_rpe": <integer 6-10>,
              "notes": "<short cue OR empty string>"
            }
          ]
        }
      ]
    }
  ]
}

Output ONLY the JSON object. No code fences. No prose before or after.
```

---

## User prompt template

The Worker fills `{{goal}}`, `{{days}}`, `{{equipment}}`, `{{experience}}`, `{{injuries}}` from the form POST.

```
Build me a 4-week workout plan.

Goal: {{goal}}
Training days per week: {{days}}
Available equipment: {{equipment}}
Experience level: {{experience}}
Injuries or movements to avoid: {{injuries}}

Return only the JSON described in the system prompt.
```

If `injuries` is empty, send `none`.

---

## Mapping form values to prompt strings

The form `<select>` values are short slugs. Translate them before sending:

| Form field   | Form value         | Prompt string                                      |
|--------------|--------------------|----------------------------------------------------|
| goal         | `lose-fat`         | `lose body fat while preserving muscle`            |
| goal         | `build-muscle`     | `build muscle (hypertrophy)`                       |
| goal         | `general-fitness`  | `general fitness and strength`                     |
| goal         | `endurance`        | `improve endurance and conditioning`               |
| equipment    | `full-gym`         | `full commercial gym (barbells, dumbbells, machines, cables)` |
| equipment    | `home-dumbbells`   | `home gym — adjustable dumbbells and a bench`     |
| equipment    | `home-barbell`     | `home gym — barbell, plates, squat rack, bench`   |
| equipment    | `bodyweight`       | `bodyweight only, no equipment`                   |
| equipment    | `bands`            | `resistance bands only`                           |
| experience   | `beginner`         | `beginner (less than 1 year of consistent lifting)` |
| experience   | `intermediate`     | `intermediate (1-3 years of consistent lifting)`  |
| experience   | `advanced`         | `advanced (3+ years of consistent lifting)`       |

---

## Test matrix (run before shipping)

The PDF playbook says "test with ~10 different combinations." Run these and check the JSON parses + the prescriptions make sense:

1. `build-muscle` / 4 days / `full-gym` / `intermediate` / none
2. `lose-fat` / 3 days / `home-dumbbells` / `beginner` / none
3. `build-muscle` / 6 days / `full-gym` / `advanced` / none
4. `general-fitness` / 3 days / `bodyweight` / `beginner` / none
5. `build-muscle` / 4 days / `home-barbell` / `intermediate` / `lower back issues, no heavy deadlifts`
6. `endurance` / 5 days / `bodyweight` / `intermediate` / none
7. `build-muscle` / 5 days / `full-gym` / `intermediate` / `right shoulder impingement, no overhead pressing`
8. `lose-fat` / 4 days / `bands` / `beginner` / none
9. `general-fitness` / 2 days / `home-dumbbells` / `intermediate` / none
10. `build-muscle` / 4 days / `full-gym` / `intermediate` / `bad knees, no jumping`

Things to check on each run:
- Valid JSON, parses without errors
- `weeks.length === 4` and each week has the same number of days as requested
- Equipment compliance (no barbell when `home-dumbbells`; no loaded lifts when `bodyweight`)
- Injury compliance (the avoided movements are absent from all 4 weeks)
- Week 4 looks like a deload (lower volume / lower target_rpe)
- Session length is realistic (5-7 exercises)

---

## Cost estimate

Per generation:
- Input tokens: ~800 (system + user prompt)
- Output tokens: ~1500-2500 (full 4-week JSON, depends on days/week)
- Haiku 4.5 pricing as of 2026 ≈ $0.001 input + $0.005 output per generation
- Round to **~$0.006 per plan** — playbook estimate of $0.005 is in the ballpark

At 10k generations/month: ~$60/month in API cost.

---

## Open questions to resolve before Worker phase

- [ ] Use Anthropic SDK directly in the Worker or raw `fetch` call? (Raw fetch is lighter — no dep needed)
- [ ] Stream the response so the user sees plan appearing live, or wait for full JSON? (Stream is friendlier UX but harder to validate as JSON)
- [ ] Cache identical inputs in Workers KV for 24h to cut cost on repeated requests? (Probably yes)
- [ ] Add a `disclaimer` field to the schema, or keep that as static UI text? (Static is fine)
