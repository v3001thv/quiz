/* Логика теста и панели администратора */
(function () {
  "use strict";
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const FX = window.FX;

  /* ---------- хранение в браузере (безопасно, с try/catch) ---------- */
  const store = {
    get(k, s = localStorage) { try { return JSON.parse(s.getItem(k)); } catch { return null; } },
    set(k, v, s = localStorage) { try { s.setItem(k, JSON.stringify(v)); } catch {} },
    del(k, s = localStorage) { try { s.removeItem(k); } catch {} },
  };
  const ATTEMPT_KEY = "quiz.attempt.v1";
  const ADMIN_KEY = "quiz.admin.v1";

  /* ---------- сеть ---------- */
  async function api(path, body) {
    let res;
    try {
      res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    } catch {
      throw new Error("Нет связи с сервером. Проверьте интернет.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || "Ошибка сервера (" + res.status + ")"); e.status = res.status; throw e; }
    return data;
  }

  /* ---------- экраны ---------- */
  function show(id) {
    $$(".screen").forEach((s) => s.classList.toggle("is-active", s.id === id));
    document.body.classList.toggle("in-quiz", id === "screen-quiz");
    window.scrollTo(0, 0);
  }

  /* ---------- тост и модальное окно ---------- */
  let toastTimer;
  function toast(msg, ms = 2800) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }
  const modal = $("#modal");
  function openModal({ title, body, actions, onOpen, dismissable = true }) {
    $("#modal-title").textContent = title;
    const mb = $("#modal-body"); mb.innerHTML = "";
    if (typeof body === "string") { const p = document.createElement("p"); p.textContent = body; mb.appendChild(p); }
    else if (body) mb.appendChild(body);
    const ma = $("#modal-actions"); ma.innerHTML = "";
    for (const a of actions || []) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn sm " + (a.cls || "btn-ghost"); b.textContent = a.label;
      if (a.id) b.id = a.id;
      b.addEventListener("click", () => a.onClick && a.onClick(b));
      ma.appendChild(b);
    }
    modal.dataset.dismissable = dismissable ? "1" : "";
    modal.hidden = false;
    onOpen && onOpen();
  }
  function closeModal() { modal.hidden = true; }
  modal.addEventListener("click", (e) => { if (e.target.hasAttribute("data-close") && modal.dataset.dismissable) closeModal(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden && modal.dataset.dismissable) closeModal(); });
  function shakeModal() { const b = $(".modal-box"); b.classList.remove("shake"); void b.offsetWidth; b.classList.add("shake"); }

  /* ---------- утилиты ---------- */
  const fmtTime = (sec) => { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function seeded(str) { // детерминированный генератор по id попытки — порядок вариантов не меняется после перезагрузки
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  }
  function countUp(el, to, { suffix = "", ms = 1400 } = {}) {
    const t0 = performance.now();
    const step = (now) => {
      const k = clamp((now - t0) / ms, 0, 1), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(to * e) + suffix;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function setHeat(v) { document.documentElement.style.setProperty("--heat", v.toFixed(3)); }

  /* =====================================================================
     ТЕСТ
     ===================================================================== */
  const S = { attemptId: null, name: "", startedAt: 0, limitSec: 420, offset: 0, questions: [], answers: {}, current: 0, timer: null, submitting: false };
  const RING = 2 * Math.PI * 52;
  const LETTERS = ["A", "B", "C", "D", "E", "F"];

  const now = () => Date.now() + S.offset;
  const remainingSec = () => (S.startedAt + S.limitSec * 1000 - now()) / 1000;
  const answeredCount = () => S.questions.filter((q) => S.answers[q.id]).length;

  function persist() {
    store.set(ATTEMPT_KEY, { attemptId: S.attemptId, name: S.name, startedAt: S.startedAt, limitSec: S.limitSec, offset: S.offset, answers: S.answers, current: S.current });
  }

  function prepareQuestions(qs) {
    const rnd = seeded(S.attemptId);
    return qs.map((q) => {
      const opts = q.options.slice();
      for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
      return { ...q, options: opts };
    });
  }

  function beginQuiz(data, saved) {
    S.attemptId = data.attemptId; S.name = data.name; S.startedAt = data.startedAt; S.limitSec = data.limitSec;
    S.offset = data.serverNow - Date.now();
    S.questions = prepareQuestions(data.questions);
    S.answers = (saved && saved.answers) || {};
    S.current = (saved && saved.current) || 0;
    S.submitting = false;
    persist();
    $("#q-name").textContent = S.name;
    $("#q-total").textContent = S.questions.length;
    buildDots();
    renderQuestion(0);
    show("screen-quiz");
    clearInterval(S.timer);
    tick();
    S.timer = setInterval(tick, 250);
  }

  function buildDots() {
    const box = $("#dots"); box.innerHTML = "";
    S.questions.forEach((q, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = i + 1; b.setAttribute("aria-label", "Вопрос " + (i + 1));
      b.addEventListener("click", () => go(i));
      box.appendChild(b);
    });
    updateDots();
  }
  function updateDots() {
    $$("#dots button").forEach((b, i) => {
      b.classList.toggle("done", Boolean(S.answers[S.questions[i].id]));
      b.classList.toggle("current", i === S.current);
    });
    $("#q-answered").textContent = answeredCount();
  }

  function renderQuestion(dir) {
    const q = S.questions[S.current];
    const card = $("#q-card");
    card.classList.remove("swap", "swap-back"); void card.offsetWidth;
    if (dir) card.classList.add(dir > 0 ? "swap" : "swap-back");
    $("#q-num").textContent = "Вопрос " + (S.current + 1) + " из " + S.questions.length;
    $("#q-text").textContent = q.text;
    const box = $("#options"); box.innerHTML = "";
    q.options.forEach((o, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "opt"; b.setAttribute("role", "radio");
      const sel = S.answers[q.id] === o.id;
      b.setAttribute("aria-checked", sel ? "true" : "false");
      if (sel) b.classList.add("selected");
      const l = document.createElement("span"); l.className = "letter"; l.textContent = LETTERS[i];
      const t = document.createElement("span"); t.textContent = o.text;
      b.append(l, t);
      b.addEventListener("click", (e) => choose(o.id, e));
      box.appendChild(b);
    });
    $("#prev-btn").disabled = S.current === 0;
    $("#next-btn").hidden = S.current === S.questions.length - 1;
    updateDots();
  }

  let advanceTimer;
  function choose(optId, e) {
    const q = S.questions[S.current];
    const first = !S.answers[q.id];
    S.answers[q.id] = optId;
    persist();
    $$("#options .opt").forEach((b, i) => {
      const on = q.options[i].id === optId;
      b.classList.toggle("selected", on); b.setAttribute("aria-checked", on ? "true" : "false");
    });
    updateDots();
    if (e && e.clientX) FX.burst(e.clientX, e.clientY, 0.32);
    clearTimeout(advanceTimer);
    if (first) {
      advanceTimer = setTimeout(() => {
        const next = nextUnanswered(S.current);
        if (next !== -1) go(next);
        else toast("Все вопросы отвечены — можно завершать! 🎯");
      }, 420);
    }
  }
  function nextUnanswered(from) {
    const n = S.questions.length;
    for (let k = 1; k <= n; k++) { const i = (from + k) % n; if (!S.answers[S.questions[i].id]) return i; }
    return -1;
  }
  function go(i) {
    if (i < 0 || i >= S.questions.length || i === S.current) return;
    const dir = i > S.current ? 1 : -1;
    S.current = i; persist(); renderQuestion(dir);
  }

  function tick() {
    const rem = remainingSec();
    const frac = clamp(rem / S.limitSec, 0, 1);
    $("#timer-text").textContent = fmtTime(Math.ceil(Math.max(0, rem)));
    $("#timer-ring").style.strokeDashoffset = String(RING * (1 - frac));
    const timer = $("#timer");
    timer.style.setProperty("--tc", frac > 0.5 ? "#5DD9C1" : frac > 0.2 ? "#FFD23F" : "#FF3B5C");

    // насколько «горит» экран: от времени и от отставания от темпа
    const total = S.questions.length, done = answeredCount();
    const timeHeat = clamp((150 - rem) / 150, 0, 1) * 0.9;
    const expected = (1 - frac) * total;
    const behind = expected - done;
    const paceHeat = done < total ? clamp((behind - 1.5) / 6, 0, 1) * 0.55 : 0;
    setHeat(Math.max(timeHeat, paceHeat));
    document.body.classList.toggle("panic", rem <= 30 && rem > 0);
    $("#pace").hidden = !(paceHeat > 0.12 && rem > 30);

    if (rem <= 0 && !S.submitting) submit(true);
  }

  async function submit(timedOut) {
    if (S.submitting) return;
    S.submitting = true;
    clearInterval(S.timer);
    clearTimeout(advanceTimer);
    $("#finish-btn").disabled = true;
    if (timedOut) toast("⏰ Время вышло! Отправляем ваши ответы…", 2200);
    let lastErr;
    for (let i = 0; i < 4; i++) {
      try {
        const data = await api("/api/submit", { attemptId: S.attemptId, answers: S.answers, timedOut });
        store.del(ATTEMPT_KEY);
        document.body.classList.remove("panic");
        showResult(data.result);
        $("#finish-btn").disabled = false;
        return;
      } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 1200 * (i + 1))); }
    }
    $("#finish-btn").disabled = false;
    S.submitting = false;
    openModal({
      title: "Не удалось отправить ответы",
      body: (lastErr && lastErr.message) || "Проверьте интернет и попробуйте ещё раз.",
      actions: [{ label: "Отправить ещё раз", cls: "btn-hot", onClick: () => { closeModal(); submit(timedOut); } }],
      dismissable: false,
    });
  }

  $("#prev-btn").addEventListener("click", () => go(S.current - 1));
  $("#next-btn").addEventListener("click", () => go(S.current + 1));
  $("#finish-btn").addEventListener("click", () => {
    const left = S.questions.length - answeredCount();
    if (left === 0) { submit(false); return; }
    openModal({
      title: "Завершить тест?",
      body: "Без ответа осталось вопросов: " + left + ". Они будут засчитаны как неверные.",
      actions: [
        { label: "Вернуться к вопросам", cls: "btn-ghost", onClick: () => { closeModal(); const n = nextUnanswered(S.current - 1 < 0 ? S.questions.length - 1 : S.current - 1); if (n !== -1) go(n); } },
        { label: "Завершить", cls: "btn-hot", onClick: () => { closeModal(); submit(false); } },
      ],
    });
  });
  addEventListener("keydown", (e) => {
    if (!$("#screen-quiz").classList.contains("is-active") || !modal.hidden) return;
    if (e.target && e.target.tagName === "INPUT") return;
    const k = e.key.toLowerCase();
    const map = { "1": 0, "2": 1, "3": 2, "4": 3, a: 0, b: 1, c: 2, d: 3, "ф": 0, "и": 1, "с": 2, "в": 3 };
    if (k in map) { const q = S.questions[S.current]; const o = q.options[map[k]]; if (o) choose(o.id); }
    else if (e.key === "ArrowRight") go(S.current + 1);
    else if (e.key === "ArrowLeft") go(S.current - 1);
  });

  /* ---------- старт ---------- */
  $("#start-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#name").value.trim();
    const err = $("#start-error");
    err.textContent = "";
    if (name.length < 2) { err.textContent = "Введите имя — хотя бы 2 символа"; $("#name").focus(); return; }
    const btn = $("#start-btn"); btn.disabled = true;
    try {
      const data = await api("/api/start", { name });
      FX.burst(innerWidth / 2, innerHeight / 2, 0.8);
      beginQuiz(data, null);
    } catch (ex) {
      err.textContent = ex.message;
    } finally { btn.disabled = false; }
  });

  /* ---------- результат ---------- */
  const TIERS = [
    { min: 10, cls: "tier-legend", emoji: "🏆", title: "Идеально!", sub: "10 из 10 — абсолютный эксперт по инновационной инфраструктуре Беларуси!" },
    { min: 9, cls: "tier-legend", emoji: "🎆", title: "Блестяще!", sub: "Почти идеальный результат — вы явно слушали очень внимательно." },
    { min: 8, cls: "tier-great", emoji: "🎇", title: "Отлично!", sub: "Сильный результат — фейерверк в вашу честь!" },
    { min: 6, cls: "tier-good", emoji: "🎉", title: "Хорошо!", sub: "Крепкий результат — до отличного совсем немного." },
    { min: 4, cls: "tier-ok", emoji: "🙂", title: "Неплохо", sub: "Основное запомнили, но кое-что стоит повторить." },
    { min: 0, cls: "tier-low", emoji: "🌧️", title: "Есть над чем поработать", sub: "Загляните ещё раз в презентацию — все ответы там." },
  ];

  function showResult(r) {
    setHeat(0);
    $("#toast").classList.remove("show");
    document.body.classList.remove("panic", "tier-legend", "tier-great", "tier-good", "tier-ok", "tier-low");
    const tier = TIERS.find((t) => r.grade >= t.min);
    document.body.classList.add(tier.cls);
    $("#r-emoji").textContent = r.timedOut && r.grade < 6 ? "⏰" : tier.emoji;
    $("#r-title").textContent = tier.title;
    $("#r-sub").textContent = (r.name ? r.name + ", " : "") + tier.sub.charAt(0).toLowerCase() + tier.sub.slice(1);
    $("#r-total").textContent = r.total;
    $("#r-time").textContent = fmtTime(r.durationSec || 0);
    const tb = $("#timeout-banner");
    tb.hidden = !r.timedOut;
    $("#r-done").textContent = r.answered;
    $("#r-left").textContent = r.total - r.answered;
    show("screen-result");

    const orb = $("#orb-ring");
    orb.style.transition = "none"; orb.style.strokeDashoffset = "540.35"; void orb.getBoundingClientRect();
    orb.style.transition = "";
    requestAnimationFrame(() => { orb.style.strokeDashoffset = String(540.35 * (1 - r.grade / 10)); });
    countUp($("#r-grade"), r.grade);
    countUp($("#r-correct"), r.correct);
    countUp($("#r-percent"), r.percent, { suffix: "%" });

    FX.clear();
    if (r.grade >= 9) {
      FX.fireworks(9000, 3.2, 1.45); FX.confetti(220);
      setTimeout(() => FX.confetti(180), 2600); setTimeout(() => FX.confetti(160), 5200);
    } else if (r.grade === 8) {
      FX.fireworks(6500, 2.2, 1.15); setTimeout(() => FX.confetti(150), 600);
    } else if (r.grade >= 6) {
      FX.confetti(150); FX.sparkles(3500, 10);
    } else if (r.grade >= 4) {
      FX.sparkles(5000, 9);
    } else {
      FX.rain(4500, 55);
    }
  }

  $("#home-btn").addEventListener("click", () => {
    FX.clear();
    document.body.classList.remove("tier-legend", "tier-great", "tier-good", "tier-ok", "tier-low");
    $("#name").value = "";
    show("screen-intro");
  });

  /* =====================================================================
     АДМИН-ПАНЕЛЬ
     ===================================================================== */
  const A = { password: null, rows: [], questions: [], sort: { key: "startedAt", asc: false }, filter: "", poll: null };
  const STATUS = { finished: "завершил(а)", timeout: "время вышло", in_progress: "проходит сейчас", abandoned: "не завершил(а)" };

  function askPassword() {
    const wrap = document.createElement("div");
    const p = document.createElement("p"); p.textContent = "Введите пароль администратора.";
    const inp = document.createElement("input"); inp.type = "password"; inp.id = "admin-pass"; inp.autocomplete = "current-password"; inp.placeholder = "Пароль";
    const err = document.createElement("p"); err.className = "err";
    wrap.append(p, inp, err);
    const submitPw = async (btn) => {
      const pw = inp.value;
      if (!pw) { shakeModal(); inp.focus(); return; }
      btn.disabled = true; err.textContent = "";
      try {
        await api("/api/admin", { password: pw, action: "login" });
        A.password = pw; store.set(ADMIN_KEY, pw, sessionStorage);
        closeModal(); openAdmin();
      } catch (ex) { err.textContent = ex.message; shakeModal(); inp.select(); }
      finally { btn.disabled = false; }
    };
    openModal({
      title: "Вход для администратора",
      body: wrap,
      actions: [
        { label: "Отмена", onClick: closeModal },
        { label: "Войти", cls: "btn-hot", id: "admin-login", onClick: (b) => submitPw(b) },
      ],
      onOpen: () => {
        setTimeout(() => inp.focus(), 50);
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") submitPw($("#admin-login")); });
      },
    });
  }

  $("#admin-btn").addEventListener("click", () => {
    const saved = store.get(ADMIN_KEY, sessionStorage);
    if (saved) { A.password = saved; openAdmin(); } else askPassword();
  });

  async function openAdmin() {
    FX.clear();
    show("screen-admin");
    await loadAdmin(true);
    clearInterval(A.poll);
    A.poll = setInterval(() => { if ($("#screen-admin").classList.contains("is-active")) loadAdmin(true); }, 20000);
  }

  async function loadAdmin(silent) {
    try {
      const data = await api("/api/admin", { password: A.password, action: "list" });
      A.rows = data.rows; A.questions = data.questions;
      renderAdmin();
      if (!silent) toast("Данные обновлены");
    } catch (ex) {
      if (ex.status === 401) { store.del(ADMIN_KEY, sessionStorage); A.password = null; show("screen-intro"); askPassword(); }
      else toast(ex.message);
    }
  }

  const done = (r) => r.status === "finished" || r.status === "timeout";

  function renderAdmin() {
    const fin = A.rows.filter(done);
    const avg = (f) => (fin.length ? fin.reduce((s, r) => s + f(r), 0) / fin.length : 0);
    const best = fin.slice().sort((a, b) => b.grade - a.grade || b.correct - a.correct)[0];
    const kp = $("#kpis"); kp.innerHTML = "";
    [
      [fin.length, "прошли тест"],
      [fin.length ? avg((r) => r.grade).toFixed(1).replace(".", ",") : "—", "средняя оценка"],
      [fin.length ? Math.round(avg((r) => r.percent)) + "%" : "—", "средний % верных"],
      [best ? best.grade + "/10" : "—", best ? "лучший: " + best.name : "лучший результат"],
    ].forEach(([v, l]) => {
      const d = document.createElement("div"); d.className = "kpi glass";
      const b = document.createElement("b"); b.textContent = v;
      const s = document.createElement("span"); s.textContent = l;
      d.append(b, s); kp.appendChild(d);
    });

    // гистограмма оценок
    const counts = Array(11).fill(0); fin.forEach((r) => counts[r.grade]++);
    const max = Math.max(1, ...counts);
    const h = $("#hist"); h.innerHTML = "";
    counts.forEach((c, g) => {
      const bar = document.createElement("div"); bar.className = "bar";
      const em = document.createElement("em"); em.textContent = c || "";
      const i = document.createElement("i"); i.style.height = "0%";
      const sm = document.createElement("small"); sm.textContent = g;
      bar.append(em, i, sm); h.appendChild(bar);
      requestAnimationFrame(() => { i.style.height = Math.max(2, (c / max) * 82) + "%"; });
    });

    // самые сложные вопросы
    const hard = $("#hard"); hard.innerHTML = "";
    const stats = A.questions.map((q) => {
      let ok = 0, n = 0;
      fin.forEach((r) => { if (r.perQuestion) { n++; if (r.perQuestion[q.id] === 1) ok++; } });
      return { q, pct: n ? Math.round((ok / n) * 100) : null };
    }).filter((s) => s.pct !== null).sort((a, b) => a.pct - b.pct).slice(0, 5);
    if (!stats.length) { const li = document.createElement("li"); li.textContent = "Появится после первых прохождений."; li.style.color = "var(--muted)"; hard.appendChild(li); }
    stats.forEach((s) => {
      const li = document.createElement("li");
      const t = document.createElement("span"); t.textContent = s.q.n + ". " + (s.q.text.length > 70 ? s.q.text.slice(0, 68) + "…" : s.q.text);
      t.title = s.q.text + "\nВерный ответ: " + s.q.correctText;
      const b = document.createElement("b"); b.textContent = s.pct + "% верно";
      const bar = document.createElement("span"); bar.className = "bar";
      const i = document.createElement("i"); i.style.width = Math.max(3, s.pct) + "%"; bar.appendChild(i);
      li.append(t, b, bar); hard.appendChild(li);
    });

    renderTable();
  }

  function renderTable() {
    const { key, asc } = A.sort;
    $$(".results th[data-sort]").forEach((th) => { th.classList.toggle("sorted", th.dataset.sort === key); th.classList.toggle("asc", th.dataset.sort === key && asc); });
    const f = A.filter.toLowerCase();
    const rows = A.rows.filter((r) => !f || r.name.toLowerCase().includes(f)).sort((a, b) => {
      let x = a[key], y = b[key];
      if (x === null || x === undefined) x = -Infinity; if (y === null || y === undefined) y = -Infinity;
      if (typeof x === "string") return asc ? x.localeCompare(y, "ru") : y.localeCompare(x, "ru");
      return asc ? x - y : y - x;
    });
    const tb = $("#rows"); tb.innerHTML = "";
    $("#empty").hidden = A.rows.length > 0;
    rows.forEach((r, idx) => {
      const tr = document.createElement("tr"); tr.style.animationDelay = Math.min(idx * 30, 600) + "ms";
      const td = (txt, cls) => { const c = document.createElement("td"); if (cls) c.className = cls; if (txt instanceof Node) c.appendChild(txt); else c.textContent = txt; tr.appendChild(c); return c; };
      td(r.name, "name");
      td(done(r) ? r.correct + " / " + r.total : "—");
      td(done(r) ? r.percent + "%" : "—");
      if (done(r)) {
        const g = document.createElement("span");
        g.className = "g " + (r.grade >= 8 ? "g-hi" : r.grade >= 6 ? "g-mid" : r.grade >= 4 ? "g-ok" : "g-lo");
        g.textContent = r.grade; td(g);
      } else td("—");
      td(done(r) ? r.answered + " / " + r.total : "—");
      td(r.durationSec != null ? fmtTime(r.durationSec) : "—");
      const st = document.createElement("span"); st.className = "st " + r.status; st.textContent = STATUS[r.status] || r.status; td(st);
      const d = new Date(r.startedAt);
      td(d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }));
      const del = document.createElement("button"); del.className = "del"; del.type = "button"; del.title = "Удалить запись"; del.setAttribute("aria-label", "Удалить запись " + r.name); del.textContent = "✕";
      del.addEventListener("click", () => confirmDelete(r));
      td(del);
      tb.appendChild(tr);
    });
  }

  $$(".results th[data-sort]").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.sort;
    A.sort = { key: k, asc: A.sort.key === k ? !A.sort.asc : k === "name" };
    renderTable();
  }));
  $("#search").addEventListener("input", (e) => { A.filter = e.target.value.trim(); renderTable(); });
  $("#refresh-btn").addEventListener("click", () => loadAdmin());
  $("#logout-btn").addEventListener("click", () => {
    store.del(ADMIN_KEY, sessionStorage); A.password = null; clearInterval(A.poll); show("screen-intro"); toast("Вы вышли из панели администратора");
  });

  function confirmDelete(r) {
    openModal({
      title: "Удалить запись?",
      body: "Результат «" + r.name + "» будет удалён без возможности восстановления.",
      actions: [
        { label: "Отмена", onClick: closeModal },
        { label: "Удалить", cls: "btn-danger solid", onClick: async (b) => {
          b.disabled = true;
          try { await api("/api/admin", { password: A.password, action: "delete", id: r.id }); closeModal(); toast("Запись удалена"); loadAdmin(true); }
          catch (ex) { toast(ex.message); b.disabled = false; }
        } },
      ],
    });
  }

  $("#clear-btn").addEventListener("click", () => {
    const n = A.rows.length;
    const wrap = document.createElement("div");
    const p = document.createElement("p"); p.textContent = "Будут удалены все записи (" + n + "). Это действие нельзя отменить. Совет: сначала скачайте CSV.";
    const p2 = document.createElement("p"); p2.innerHTML = "Для подтверждения введите слово <b style=\"color:#FFD23F\">ОЧИСТИТЬ</b>";
    const inp = document.createElement("input"); inp.placeholder = "ОЧИСТИТЬ"; inp.id = "clear-confirm";
    wrap.append(p, p2, inp);
    openModal({
      title: "Очистить всю историю?",
      body: wrap,
      actions: [
        { label: "Отмена", onClick: closeModal },
        { label: "Да, удалить всё", cls: "btn-danger solid", id: "clear-go", onClick: async (b) => {
          if (inp.value.trim().toUpperCase() !== "ОЧИСТИТЬ") { shakeModal(); inp.focus(); return; }
          b.disabled = true;
          try {
            const r = await api("/api/admin", { password: A.password, action: "clear" });
            closeModal(); toast("История очищена: удалено записей — " + r.deleted); loadAdmin(true);
          } catch (ex) { toast(ex.message); b.disabled = false; }
        } },
      ],
      onOpen: () => setTimeout(() => inp.focus(), 50),
    });
  });

  $("#csv-btn").addEventListener("click", () => {
    if (!A.rows.length) { toast("Пока нечего скачивать"); return; }
    const head = ["Имя", "Правильных", "Всего", "Процент", "Оценка (0-10)", "Отвечено", "Время (мин:сек)", "Статус", "Начало"];
    const q = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const lines = [head.map(q).join(";")].concat(A.rows.map((r) => [
      r.name, r.correct ?? "", r.total, r.percent ?? "", r.grade ?? "", r.answered ?? "",
      r.durationSec != null ? fmtTime(r.durationSec) : "", STATUS[r.status] || r.status,
      new Date(r.startedAt).toLocaleString("ru-RU"),
    ].map(q).join(";")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "rezultaty-testa-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  /* =====================================================================
     ЗАПУСК: продолжить незаконченную попытку после перезагрузки
     ===================================================================== */
  (async function init() {
    const saved = store.get(ATTEMPT_KEY);
    if (!saved || !saved.attemptId) return;
    try {
      const data = await api("/api/attempt", { attemptId: saved.attemptId });
      if (data.finished) { store.del(ATTEMPT_KEY); showResult(data.result); return; }
      beginQuiz(data, saved);
      toast("Продолжаем тест — таймер не останавливался ⏱");
    } catch (ex) {
      if (ex.status === 404) store.del(ATTEMPT_KEY);
      else toast(ex.message);
    }
  })();
})();
