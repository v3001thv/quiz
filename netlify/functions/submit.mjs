import { attempts, json, readBody, gradeFrom, publicResult } from "../lib/common.mjs";
import { QUESTIONS, TIME_LIMIT_SEC, GRACE_SEC } from "../lib/questions.mjs";

// POST /api/submit  { attemptId, answers: { q1: "a", ... }, timedOut }
// Проверка ответов идёт здесь, на сервере.
export default async (req) => {
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);
  const body = await readBody(req);
  const id = String(body?.attemptId ?? "");
  if (!id) return json({ error: "Нет идентификатора попытки" }, 400);

  const store = attempts();
  const rec = await store.get(id, { type: "json" });
  if (!rec) return json({ error: "Попытка не найдена" }, 404);

  // Повторная отправка — просто вернуть уже сохранённый результат
  if (rec.status !== "in_progress") return json({ result: publicResult(rec) });

  const raw = body?.answers && typeof body.answers === "object" ? body.answers : {};
  const answers = {};
  let answered = 0;
  let correct = 0;
  const perQuestion = {};
  for (const q of QUESTIONS) {
    const a = raw[q.id];
    if (typeof a === "string" && Object.prototype.hasOwnProperty.call(q.options, a)) {
      answers[q.id] = a;
      answered++;
      const ok = a === q.correct;
      if (ok) correct++;
      perQuestion[q.id] = ok ? 1 : 0;
    } else {
      perQuestion[q.id] = null; // без ответа
    }
  }

  const now = Date.now();
  const elapsedSec = (now - rec.startedAt) / 1000;
  const timedOut = Boolean(body?.timedOut) || elapsedSec > TIME_LIMIT_SEC + GRACE_SEC;
  const total = QUESTIONS.length;

  const updated = {
    ...rec,
    status: timedOut ? "timeout" : "finished",
    finishedAt: now,
    durationSec: Math.min(Math.round(elapsedSec), TIME_LIMIT_SEC),
    answered,
    correct,
    percent: Math.round((correct / total) * 100),
    grade: gradeFrom(correct, total),
    answers,
    perQuestion,
  };
  await store.setJSON(id, updated);
  return json({ result: publicResult(updated) });
};

export const config = { path: "/api/submit" };
