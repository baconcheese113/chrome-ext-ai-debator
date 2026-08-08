/**
 * A fake chat provider whose misbehaviour is switchable.
 *
 * Every mode here reproduces something a real provider actually did to us during the spike
 * or during manual testing. That is the point: these failures were previously only
 * observable by accident, on someone else's servers, at their pace.
 *
 *   ?mode=normal      well-behaved
 *   ?mode=artifact    real content lands in the side panel; thread gets a summary  (Claude Cowork)
 *   ?mode=empty-tail  reply lands, then an empty trailing message node is appended  (ChatGPT canvas)
 *   ?mode=truncate    stream stops mid-sentence and the stop button vanishes        (minimized throttling)
 *   ?mode=no-stop     never shows a stop button, forcing the slow quiescence path
 *   ?mode=echo        replies with the prompt instead of an answer                  (Gemini throttled)
 *   ?mode=silent      accepts the prompt and never replies at all
 *   ?mode=slow        long mid-stream pauses, to attack false-positive completion
 *
 *   &words=N          length of the generated reply (default 220)
 *   &speed=N          ms between chunks (default 20)
 *   &converge=yes|no  value of the CONVERGED footer (default no)
 */

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'normal';
const words = Number(params.get('words') ?? 220);
const speed = Number(params.get('speed') ?? 20);
const converge = params.get('converge') ?? 'no';

const thread = document.getElementById('thread');
const composer = document.getElementById('composer');
const sendBtn = document.getElementById('send');
const stopBtn = document.getElementById('stop');
const artifact = document.getElementById('artifact');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LOREM = [
  'concurrency', 'throughput', 'latency', 'contention', 'partition', 'quorum', 'idempotent',
  'backpressure', 'consistency', 'replication', 'invariant', 'scheduler', 'coordination',
];

function body(prompt) {
  if (mode === 'echo') return `You said\n\n${prompt}`;
  const out = [];
  for (let i = 0; i < words; i++) out.push(LOREM[i % LOREM.length]);
  return `Considering the question, here is the reasoning. ${out.join(' ')}.`;
}

function append(cls, text) {
  const el = document.createElement('div');
  el.className = `msg ${cls}`;
  if (cls === 'assistant') el.dataset.role = 'assistant';
  el.textContent = text;
  thread.appendChild(el);
  return el;
}

async function stream(el, text) {
  const chunks = text.split(' ');
  for (let i = 0; i < chunks.length; i++) {
    el.textContent += (i ? ' ' : '') + chunks[i];
    // A long pause mid-stream is exactly what makes naive quiescence fire early.
    if (mode === 'slow' && i === Math.floor(chunks.length / 2)) await sleep(2500);
    // Cut at a fixed, small number of chunks rather than a fraction, so the result is short
    // enough to be *detectably* truncated regardless of the configured length.
    if (mode === 'truncate' && i >= 5) return false;
    await sleep(speed);
  }
  return true;
}

async function respond(prompt) {
  if (mode === 'silent') return;

  if (mode !== 'no-stop') stopBtn.hidden = false;
  sendBtn.disabled = true;

  const full = `${body(prompt)}\nCONVERGED: ${converge} — mock reason`;

  if (mode === 'artifact') {
    // The thread gets a summary; the answer goes somewhere the naive extractor can't see.
    const msg = append('assistant', '');
    await stream(msg, 'Done — I wrote it up in the panel.');
    artifact.classList.add('open');
    artifact.querySelector('.artifact-body').textContent = full;
  } else {
    const msg = append('assistant', '');
    const completed = await stream(msg, full);
    if (!completed) {
      // Truncation looks exactly like success from the outside. That is the danger.
      stopBtn.hidden = true;
      sendBtn.disabled = false;
      return;
    }
    if (mode === 'empty-tail') append('assistant', '');
  }

  stopBtn.hidden = true;
  sendBtn.disabled = false;
}

function submit() {
  const prompt = composer.innerText.trim();
  if (!prompt) return;
  append('user', prompt);
  composer.innerHTML = '';
  void respond(prompt);
}

sendBtn.addEventListener('click', submit);
stopBtn.addEventListener('click', () => {
  stopBtn.hidden = true;
  sendBtn.disabled = false;
});
composer.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
});

// Ambient DOM churn unrelated to the conversation — a clock ticking in the corner, the kind
// of thing that made a document.body-scoped observer never see the page go quiet.
const noise = document.createElement('div');
noise.setAttribute('aria-hidden', 'true');
noise.style.cssText = 'position:fixed;bottom:2px;right:4px;color:#bbb;font-size:10px';
document.body.appendChild(noise);
setInterval(() => (noise.textContent = String(Date.now())), 300);
