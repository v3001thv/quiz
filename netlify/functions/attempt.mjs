import { attempts, json, readBody, publicResult } from "../lib/common.mjs";
import { TIME_LIMIT_SEC, publicQuestions } from "../lib/questions.mjs";

// POST /api/attempt  { attemptId }  →  для продолжения теста после перезагрузки страницы
export default async (req) => {
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);
  const body = await readBody(req);
  const id = String(body?.attemptId ?? "");
  if (!id) return json({ error: "Нет идентификатора попытки" }, 400);

  const rec = await attempts().get(id, { type: "json" });
  if (!rec) return json({ error: "Попытка не найдена" }, 404);

  if (rec.status !== "in_progress") {
    return json({ finished: true, result: publicResult(rec) });
  }
  return json({
    finished: false,
    attemptId: rec.id,
    name: rec.name,
    startedAt: rec.startedAt,
    serverNow: Date.now(),
    limitSec: TIME_LIMIT_SEC,
    questions: publicQuestions(),
  });
};

export const config = { path: "/api/attempt" };
