const SYSTEM_PROMPT = `You are a certified strength and conditioning coach (CSCS-equivalent) building a 4-week workout plan for one specific person. You write programs that real intermediate lifters and beginners actually follow — not theoretical templates from a textbook.

You will be given the user's goal, weekly training frequency, available equipment, experience level, and any injuries. You will return ONE valid JSON object matching the schema below — no preamble, no commentary, no markdown fences. Just the JSON.

# Hard rules

1. RESPECT EQUIPMENT. If the user only has dumbbells, never prescribe a barbell movement. If bodyweight only, never prescribe loaded movements. Substitute appropriately (e.g. goblet squat instead of back squat for dumbbell-only).

2. RESPECT INJURIES. If the user lists an injury or movement to avoid, do not prescribe contraindicated exercises. Pick safer alternatives that still hit the same muscle group. If the injury is serious enough that you can't program around it (e.g. acute disc herniation requesting heavy deadlifts), say so in the \`safety_note\` field and program conservatively.

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

Output ONLY the JSON object. No code fences. No prose before or after.`;

const GOAL_MAP = {
  'lose-fat': 'lose body fat while preserving muscle',
  'build-muscle': 'build muscle (hypertrophy)',
  'general-fitness': 'general fitness and strength',
  'endurance': 'improve endurance and conditioning'
};

const EQUIPMENT_MAP = {
  'full-gym': 'full commercial gym (barbells, dumbbells, machines, cables)',
  'home-dumbbells': 'home gym — adjustable dumbbells and a bench',
  'home-barbell': 'home gym — barbell, plates, squat rack, bench',
  'bodyweight': 'bodyweight only, no equipment',
  'bands': 'resistance bands only'
};

const EXPERIENCE_MAP = {
  'beginner': 'beginner (less than 1 year of consistent lifting)',
  'intermediate': 'intermediate (1-3 years of consistent lifting)',
  'advanced': 'advanced (3+ years of consistent lifting)'
};

const FREE_PLANS_PER_MONTH = 1;
const PLAN_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/generate') {
      if (request.method !== 'POST') return jsonError('Method not allowed', 405);
      return handleGenerate(request, env, ctx);
    }

    const planMatch = url.pathname.match(/^\/api\/plan\/([a-z0-9]{6,32})$/);
    if (planMatch) {
      if (request.method !== 'GET') return jsonError('Method not allowed', 405);
      return handleGetPlan(planMatch[1], env);
    }

    // Pretty share URLs like /plan/<id> serve the SPA with per-plan meta tags injected.
    const planPageMatch = url.pathname.match(/^\/plan\/([a-z0-9]{6,32})$/);
    if (planPageMatch) {
      return handlePlanPage(planPageMatch[1], url, request, env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handlePlanPage(id, url, request, env) {
  const indexUrl = new URL(request.url);
  indexUrl.pathname = '/';
  const indexResponse = await env.ASSETS.fetch(new Request(indexUrl, request));

  if (!env.RATE_LIMIT) return indexResponse;
  const planRaw = await env.RATE_LIMIT.get(`plan:${id}`);
  if (!planRaw) return indexResponse;

  let plan;
  try { plan = JSON.parse(planRaw); } catch { return indexResponse; }

  const s = plan.summary || {};
  const split = s.split || 'Workout';
  const days = s.days_per_week || 4;
  const weeks = s.duration_weeks || 4;
  const goal = s.goal || 'fitness';
  const equipment = s.equipment || '';
  const experience = s.experience || '';

  const title = `${days}-day ${split} plan — LiftGenie`;
  const description = `${weeks}-week ${split} plan for ${goal}. ${equipment}${experience ? ` · ${experience}` : ''}. Generated free by LiftGenie.`
    .replace(/\s+/g, ' ').trim();
  const canonical = `${url.origin}${url.pathname}`;

  return new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(title); } })
    .on('meta[name="description"]', { element(el) { el.setAttribute('content', description); } })
    .on('meta[property="og:title"]', { element(el) { el.setAttribute('content', title); } })
    .on('meta[property="og:description"]', { element(el) { el.setAttribute('content', description); } })
    .on('meta[property="og:url"]', { element(el) { el.setAttribute('content', canonical); } })
    .on('meta[property="og:type"]', { element(el) { el.setAttribute('content', 'article'); } })
    .on('meta[name="twitter:title"]', { element(el) { el.setAttribute('content', title); } })
    .on('meta[name="twitter:description"]', { element(el) { el.setAttribute('content', description); } })
    .on('link[rel="canonical"]', { element(el) { el.setAttribute('href', canonical); } })
    .transform(indexResponse);
}

function generateId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function handleGetPlan(id, env) {
  if (!env.RATE_LIMIT) return jsonError('Storage not configured', 500);
  const raw = await env.RATE_LIMIT.get(`plan:${id}`);
  if (!raw) return jsonError('Plan not found or expired', 404);
  return new Response(raw, {
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function getRateKey(request) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `rate:${ip}:${month}`;
}

async function handleGenerate(request, env, ctx) {
  if (!env.ANTHROPIC_API_KEY) {
    return jsonError('Server is not configured (missing API key)', 500);
  }

  const bypass = env.BYPASS_TOKEN && request.headers.get('x-bypass-token') === env.BYPASS_TOKEN;

  if (env.RATE_LIMIT && !bypass) {
    const key = getRateKey(request);
    const current = Number.parseInt(await env.RATE_LIMIT.get(key), 10) || 0;
    if (current >= FREE_PLANS_PER_MONTH) {
      return jsonError('Free tier limit reached (1 plan/month). Upgrade to Pro for unlimited.', 429);
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Request body must be valid JSON', 400);
  }

  const { goal, days, equipment, experience, injuries } = body || {};

  if (!GOAL_MAP[goal]) return jsonError('Invalid goal', 400);
  if (!EQUIPMENT_MAP[equipment]) return jsonError('Invalid equipment', 400);
  if (!EXPERIENCE_MAP[experience]) return jsonError('Invalid experience', 400);

  const daysNum = Number.parseInt(days, 10);
  if (!Number.isInteger(daysNum) || daysNum < 2 || daysNum > 6) {
    return jsonError('Days per week must be between 2 and 6', 400);
  }

  const injuriesText = (typeof injuries === 'string' && injuries.trim())
    ? injuries.trim().slice(0, 500)
    : 'none';

  const userMessage = `Build me a 4-week workout plan.

Goal: ${GOAL_MAP[goal]}
Training days per week: ${daysNum}
Available equipment: ${EQUIPMENT_MAP[equipment]}
Experience level: ${EXPERIENCE_MAP[experience]}
Injuries or movements to avoid: ${injuriesText}

Return only the JSON described in the system prompt.`;

  let apiResponse;
  try {
    apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 16384,
        temperature: 0.7,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }
        ],
        messages: [{ role: 'user', content: userMessage }]
      })
    });
  } catch (err) {
    console.error('Anthropic fetch failed:', err);
    return jsonError('Could not reach the AI service', 502);
  }

  if (!apiResponse.ok) {
    const errText = await apiResponse.text().catch(() => '');
    console.error('Anthropic API error:', apiResponse.status, errText);
    return jsonError(`AI service returned ${apiResponse.status}`, 502);
  }

  const data = await apiResponse.json();
  const planText = data?.content?.[0]?.text;
  if (!planText) {
    console.error('Empty content from Anthropic:', JSON.stringify(data).slice(0, 500));
    return jsonError('Empty response from AI', 502);
  }

  if (data?.stop_reason === 'max_tokens') {
    console.error('Hit max_tokens — output truncated. Length:', planText.length);
    return jsonError('Plan was too long to fit. Try fewer days/week.', 502);
  }

  const plan = tryParsePlan(planText);
  if (!plan) {
    console.error('AI returned non-JSON. stop_reason:', data?.stop_reason, 'text head:', planText.slice(0, 200), 'tail:', planText.slice(-200));
    return jsonError('AI returned malformed plan', 502);
  }

  if (env.RATE_LIMIT && !bypass) {
    const key = getRateKey(request);
    const current = Number.parseInt(await env.RATE_LIMIT.get(key), 10) || 0;
    ctx.waitUntil(
      env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: 60 * 60 * 24 * 35 })
    );
  }

  let id = null;
  if (env.RATE_LIMIT) {
    id = generateId();
    plan.id = id;
    ctx.waitUntil(
      env.RATE_LIMIT.put(`plan:${id}`, JSON.stringify(plan), { expirationTtl: PLAN_TTL_SECONDS })
    );
  }

  return new Response(JSON.stringify(plan), {
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function tryParsePlan(raw) {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  // Strip ```json ... ``` or ``` ... ``` fences if Claude added them
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1].trim();
  try { return JSON.parse(text); } catch {}
  // Fallback: extract the substring from first { to last }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch {}
  }
  return null;
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
