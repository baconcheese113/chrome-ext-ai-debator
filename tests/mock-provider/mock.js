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
 *   ?mode=stuck-stop  replies in full but leaves the stop button visible forever (real Claude)
 *   ?mode=virtualized unmounts off-screen turns into empty placeholders          (real ChatGPT)
 *   ?mode=thinking    posts a short "Thinking" header, shows NO stop button, then holds the
 *                     DOM completely static before writing the real answer      (real Kimi)
 *
 *   &words=N          length of the generated reply (default 220)
 *   &thinkms=N        length of the silent reasoning gap in `thinking` mode (default 9000)
 *   &speed=N          ms between chunks (default 20)
 *   &converge=yes|no  value of the CONVERGED footer (default no)
 */

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'normal';
const words = Number(params.get('words') ?? 220);
const speed = Number(params.get('speed') ?? 20);
const converge = params.get('converge') ?? 'no';
const thinkMs = Number(params.get('thinkms') ?? 9000);

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

/**
 * Replies carry a sequence number so successive turns are distinguishable. Without it every
 * reply is byte-identical, and "we did not return the previous turn" cannot be asserted —
 * a test claiming to check that would pass no matter what.
 */
let turnSeq = 0;

function body(prompt) {
  if (mode === 'echo') return `You said\n\n${prompt}`;
  const out = [];
  for (let i = 0; i < words; i++) out.push(LOREM[i % LOREM.length]);
  return `Reply #${++turnSeq}. Considering the question, here is the reasoning. ${out.join(' ')}.`;
}

let msgSeq = 0;

function append(cls, text) {
  const el = document.createElement('div');
  el.className = `msg ${cls}`;
  if (cls === 'assistant') el.dataset.role = 'assistant';
  // A stable per-turn id, as every real provider exposes. The driver keys turn identity off
  // this, which is what makes it immune to virtualization.
  msgSeq++;
  // 'shared-id' reproduces real Claude: turns carry no id of their own, every ancestor
  // attribute is shared page furniture, and consecutive replies can be byte-identical
  // ("READY" twice). Identity has to come from aria-posinset, and a scheme that yields the
  // same key for every turn must be detected and rejected rather than trusted.
  if (mode !== 'shared-id') el.dataset.msgId = `m${msgSeq}`;
  el.textContent = text;

  const article = document.createElement('div');
  article.setAttribute('role', 'article');
  article.setAttribute('aria-posinset', String(msgSeq));
  article.appendChild(el);
  thread.appendChild(article);

  // Real ChatGPT swaps off-screen turns for empty placeholder divs, so the number of
  // rendered assistant messages stops growing with the conversation — it stays flat or
  // drops. Counting rendered turns waits forever; identity does not.
  if (mode === 'virtualized') {
    for (const old of thread.querySelectorAll('.msg.assistant')) {
      if (old !== el) {
        old.textContent = '';
        old.classList.remove('assistant');
        old.removeAttribute('data-role');
      }
    }
  }
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

  // 'thinking' hides the stop button on purpose: that is the Kimi shape exactly — a real
  // stop control exists but our adapter does not know its selector, so silence is the only
  // signal the driver has, and the model is about to be silent for a long time.
  if (mode !== 'no-stop' && mode !== 'thinking') stopBtn.hidden = false;
  sendBtn.disabled = true;

  const full = `${body(prompt)}\nCONVERGED: ${converge} — mock reason`;

  if (mode === 'thinking') {
    // A reasoning model's header lands immediately and is plausible-looking but far too
    // short. Then nothing at all happens — no stream, no spinner, no mutation — until the
    // answer starts. Reading during that gap yields a confident fragment.
    const msg = append('assistant', 'Thinking…');
    await sleep(thinkMs);
    await stream(msg, `\n${full}`);
    sendBtn.disabled = false;
    return;
  }

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

  // Observed on a real idle Claude thread: the reply is finished but "Stop response" stays
  // in the DOM. Leaving it visible here keeps the detector honest about stale UI.
  if (mode !== 'stuck-stop') stopBtn.hidden = true;
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
