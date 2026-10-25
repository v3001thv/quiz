import { attempts, json, readBody, isAdmin, sleep } from "../lib/common.mjs";
import { QUESTIONS, TIME_LIMIT_SEC, GRACE_SEC } from "../lib/questions.mjs";

// POST /api/admin  { password, action: "login" | "list" | "clear" | "delete", id? }
export default async (req) => {
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);
  const body = await readBody(req);
  if (!isAdmin(body?.password)) {
    await sleep(700); // замедляем подбор пароля
    return json({ error: "Неверный пароль" }, 401);
  }

  const store = attempts();
  const action = body?.action;

  if (action === "login") return json({ ok: true });

  if (action === "list") {
    const { blobs } = await store.list();
    const records = (
      await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))
    ).filter(Boolean);

    const now = Date.now();
    const rows = records
      .map((r) => {
        let status = r.status;
        // начал, но так и не отправил (закрыл вкладку и т. п.)
        if (status === "in_progress" && now - r.startedAt > (TIME_LIMIT_SEC + GRACE_SEC + 60) * 1000) {
          status = "abandoned";
        }
        return {
          id: r.id,
          name: r.name,
          status,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt ?? null,
          durationSec: r.durationSec ?? null,
          total: r.total,
          answered: r.answered ?? null,
          correct: r.correct ?? null,
          percent: r.percent ?? null,
          grade: r.grade ?? null,
          perQuestion: r.perQuestion ?? null,
        };
      })
      .sort((a, b) => b.startedAt - a.startedAt);

    const questions = QUESTIONS.map((q, i) => ({
      id: q.id,
      n: i + 1,
      text: q.text,
      correctText: q.options[q.correct],
    }));
    return json({ rows, questions, limitSec: TIME_LIMIT_SEC });
  }

  if (action === "delete") {
    const id = String(body?.id ?? "");
    if (!id) return json({ error: "Не указана запись" }, 400);
    await store.delete(id);
    return json({ ok: true });
  }

  if (action === "clear") {
    const { blobs } = await store.list();
    await Promise.all(blobs.map((b) => store.delete(b.key)));
    return json({ ok: true, deleted: blobs.length });
  }

  return json({ error: "Неизвестное действие" }, 400);
};

export const config = { path: "/api/admin" };
