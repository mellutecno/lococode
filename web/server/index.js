import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const repoDir = path.resolve(rootDir, "..");
const dataDir = path.join(rootDir, "data");
const projectsDir = path.join(dataDir, "projects");
const appsPath = path.join(dataDir, "apps.json");
const configPath = path.join(dataDir, "config.json");
const legacyConfigPath = path.join(repoDir, "user_data", "config.json");
const port = Number(process.env.LOCOCODE_API_PORT || 8787);
const openRouterTimeoutMs = Number(process.env.OPENROUTER_TIMEOUT_MS || 0);
const runningJobs = new Map();

const commonModels = [
  "deepseek/deepseek-v4-pro",
  "moonshotai/kimi-k2.6",
];

const app = express();
app.use((req, res, next) => {
  const allowedOrigin = process.env.LOCOCODE_ALLOWED_ORIGIN || req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: "12mb" }));

await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(projectsDir, { recursive: true });

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mode: "web-sdd-orchestrator" });
});

app.get("/api/models", (_req, res) => {
  res.json({ models: commonModels });
});

app.get("/api/settings", async (_req, res) => {
  res.json(await loadSettings());
});

app.post("/api/settings", async (req, res) => {
  const settings = {
    openrouterApiKey: String(req.body.openrouterApiKey || "").trim(),
    defaultModel: normalizeModelId(req.body.defaultModel || commonModels[0]),
  };
  await fs.writeFile(configPath, JSON.stringify(settings, null, 2), "utf8");
  res.json(settings);
});

app.post("/api/check-openrouter", async (req, res) => {
  const settings = await loadSettings();
  const apiKey = String(req.body.openrouterApiKey || settings.openrouterApiKey || "").trim();
  const model = normalizeModelId(req.body.model || settings.defaultModel || commonModels[0]);

  if (!apiKey) {
    res.status(400).json({ ok: false, error: "API key mancante." });
    return;
  }

  const started = Date.now();
  try {
    await callOpenRouter({
      apiKey,
      model,
      maxTokens: 250,
      timeoutMs: 30000,
      systemPrompt: "Return only the word OK.",
      userPrompt: "Connection test.",
    });
    res.json({ ok: true, model, ms: Date.now() - started });
  } catch (err) {
    res.status(502).json({
      ok: false,
      model,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get("/api/apps", async (_req, res) => {
  const apps = await loadApps();
  for (const target of apps) {
    await refreshProjectState(target);
    if (!target.autopilot?.running && target.status === "ready" && target.sdd?.currentStep) {
      target.status = "partial";
    }
    if (target.status === "building" && target.files?.length && !target.html && !target.autopilot?.running) {
      target.status = "partial";
      target.messages = Array.isArray(target.messages) ? target.messages : [];
      if (!target.messages.some((message) => message.content?.includes("Generazione interrotta"))) {
        target.messages.push({
          role: "assistant",
          content: "Generazione interrotta o chiusa prima del completamento. Ho recuperato i file gia creati: puoi leggere SDD e File; l'autopilota puo riprendere dal prossimo task.",
          at: new Date().toISOString(),
        });
      }
    }
  }
  await saveApps(apps);
  res.json({ apps: apps.map(publicApp) });
});

app.get("/api/apps/:id/files", async (req, res) => {
  const apps = await loadApps();
  const target = apps.find((item) => item.id === req.params.id);
  if (!target) {
    res.status(404).json({ error: "App non trovata." });
    return;
  }

  const root = projectRoot(target.id);
  const files = await listProjectFiles(root);
  const payload = [];
  for (const relPath of files) {
    payload.push({
      path: relPath,
      content: await readProjectFile(target.id, relPath),
    });
  }
  res.json({ files: payload });
});

app.post("/api/generate", async (req, res) => {
  const prompt = String(req.body.prompt || "").trim();
  const requestedModel = normalizeModelId(req.body.model || "");
  const appId = String(req.body.appId || "").trim();

  if (!prompt) {
    res.status(400).json({ error: "Prompt mancante." });
    return;
  }

  const settings = await loadSettings();
  const model = requestedModel || settings.defaultModel || commonModels[0];
  const apiKey = String(req.body.openrouterApiKey || settings.openrouterApiKey || "").trim();

  if (!apiKey) {
    res.status(400).json({
      error: "API key OpenRouter mancante. Salvala nelle impostazioni prima di generare.",
    });
    return;
  }

  const apps = await loadApps();
  const now = new Date().toISOString();
  let target = apps.find((item) => item.id === appId);
  const isNewApp = !target;

  if (!target) {
    target = {
      id: `app-${Date.now()}`,
      name: titleFromPrompt(prompt),
      createdAt: now,
      updatedAt: now,
      model,
      prompt,
      status: "building",
      phase: "intake",
      html: "",
      files: [],
      messages: [],
      sdd: emptySddState(),
    };
    apps.unshift(target);
    await createInitialWorkspace(target, prompt);
  }

  if (target.autopilot?.running || runningJobs.has(target.id)) {
    res.status(409).json({
      error: "Questo progetto sta gia lavorando. Attendi il completamento oppure controlla il registro operativo.",
      app: publicApp(target),
    });
    return;
  }

  target.updatedAt = now;
  target.model = model;
  target.status = "building";
  target.autopilot = {
    running: true,
    currentTask: isNewApp ? "Preparazione SDD e piano operativo" : "Applicazione modifica richiesta",
    completed: 0,
    total: target.sdd?.steps?.length || 0,
    startedAt: now,
    updatedAt: now,
    lastMessage: "Lavoro avviato in background.",
    error: null,
  };
  target.messages = Array.isArray(target.messages) ? target.messages : [];
  target.messages.push({ role: "user", content: prompt, at: now });
  await saveApps(apps);

  startAutopilotJob({
    appId: target.id,
    apiKey,
    model,
    userPrompt: prompt,
    mode: isNewApp ? "initial" : "change",
  });

  res.json({ app: publicApp(target), usedAi: true, queued: true, error: "" });
});

app.post("/api/apps/:id/continue", startAutopilotRequest);
app.post("/api/apps/:id/autopilot", startAutopilotRequest);

async function startAutopilotRequest(req, res) {
  const settings = await loadSettings();
  const apps = await loadApps();
  const target = apps.find((item) => item.id === req.params.id);

  if (!target) {
    res.status(404).json({ error: "App non trovata." });
    return;
  }

  const model = normalizeModelId(req.body.model || target.model || settings.defaultModel || commonModels[0]);
  const apiKey = String(req.body.openrouterApiKey || settings.openrouterApiKey || "").trim();

  if (!apiKey) {
    res.status(400).json({
      error: "API key OpenRouter mancante. Salvala nelle impostazioni prima di continuare.",
    });
    return;
  }

  if (target.autopilot?.running || runningJobs.has(target.id)) {
    res.json({ app: publicApp(target), usedAi: true, queued: true, alreadyRunning: true, error: "" });
    return;
  }

  const now = new Date().toISOString();
  target.status = "building";
  target.model = model;
  target.updatedAt = now;
  target.autopilot = {
    running: true,
    currentTask: target.sdd?.currentStep?.label || "Ripresa dal prossimo task SDD",
    completed: target.sdd?.steps?.filter((step) => step.done).length || 0,
    total: target.sdd?.steps?.length || 0,
    startedAt: now,
    updatedAt: now,
    lastMessage: "Autopilota riavviato.",
    error: null,
  };
  target.messages = Array.isArray(target.messages) ? target.messages : [];
  target.messages.push({
    role: "assistant",
    content: "Autopilota riavviato: continuo automaticamente dal prossimo task SDD e mi fermo solo in caso di errore.",
    at: now,
  });
  await saveApps(apps);

  startAutopilotJob({ appId: target.id, apiKey, model, userPrompt: "", mode: "continue" });
  res.json({ app: publicApp(target), usedAi: true, queued: true, error: "" });
}

app.get("/api/apps/:id/preview", async (req, res) => {
  const apps = await loadApps();
  const target = apps.find((item) => item.id === req.params.id);
  if (!target) {
    res.status(404).send("App non trovata");
    return;
  }

  const html = await readPreviewHtml(target);
  if (!html) {
    res.status(404).send("Preview non disponibile: l'orchestrator non ha ancora creato preview/index.html.");
    return;
  }

  res.type("html").send(html);
});

const distDir = path.join(rootDir, "dist");
app.use(express.static(distDir));
app.use(async (_req, res, next) => {
  try {
    await fs.access(path.join(distDir, "index.html"));
    res.sendFile(path.join(distDir, "index.html"));
  } catch {
    next();
  }
});

app.listen(port, () => {
  console.log(`LocoCode API running on http://localhost:${port}`);
});

function startAutopilotJob({ appId, apiKey, model, userPrompt = "", mode = "continue" }) {
  if (runningJobs.has(appId)) return false;

  const job = runAutopilotJob({ appId, apiKey, model, userPrompt, mode })
    .catch((err) => {
      console.error(`Autopilot job failed for ${appId}:`, err);
    })
    .finally(() => {
      runningJobs.delete(appId);
    });

  runningJobs.set(appId, job);
  return true;
}

async function runAutopilotJob({ appId, apiKey, model, userPrompt = "", mode = "continue" }) {
  const apps = await loadApps();
  const target = apps.find((item) => item.id === appId);
  if (!target) return;

  const saveProgress = async (phaseLabel = "") => {
    await refreshProjectState(target);
    const steps = target.sdd?.steps || [];
    const currentTask = phaseLabel || target.sdd?.currentStep?.label || target.autopilot?.currentTask || "Preparazione progetto";
    appendOperationalLog(target, phaseLabel ? `Fase in corso: ${phaseLabel}` : `Task aggiornato: ${currentTask}`);
    target.autopilot = {
      ...(target.autopilot || {}),
      running: true,
      currentTask,
      completed: steps.filter((step) => step.done).length,
      total: steps.length,
      updatedAt: new Date().toISOString(),
      lastMessage: phaseLabel ? `Fase in corso: ${phaseLabel}` : "Task aggiornato.",
      error: null,
    };
    target.status = "building";
    target.updatedAt = target.autopilot.updatedAt;
    await saveApps(apps);
  };

  try {
    await saveProgress(mode === "initial" ? "Preparazione SDD e piano operativo" : target.sdd?.currentStep?.label || "Prossimo task SDD");

    if (mode === "initial") {
      const result = await runOrchestratorTurn({
        target,
        apiKey,
        model,
        userPrompt,
        mode: "initial",
        onProgress: async (phaseLabel) => saveProgress(`Completata fase: ${phaseLabel}`),
      });
      pushAssistantMessage(target, result.summary);
    } else if (mode === "change") {
      await saveProgress("Applicazione modifica richiesta");
      const result = await runOrchestratorTurn({
        target,
        apiKey,
        model,
        userPrompt,
        mode: "change",
        onProgress: async () => saveProgress("Modifica applicata"),
      });
      pushAssistantMessage(target, result.summary);
    }

    await refreshProjectState(target);

    const maxTurns = 40;
    let turns = 0;
    let stallCount = 0;

    while (target.sdd?.currentStep && turns < maxTurns) {
      const beforeTask = getNextTaskLabel(target);
      const beforeDone = (target.sdd?.steps || []).filter((step) => step.done).length;

      await saveProgress(beforeTask || "Prossimo task SDD");
      const result = await runOrchestratorTurn({
        target,
        apiKey,
        model,
        userPrompt: "",
        mode: "continue",
        onProgress: async () => saveProgress(beforeTask || "Task SDD in corso"),
      });

      pushAssistantMessage(target, result.summary);
      await refreshProjectState(target);

      const afterTask = getNextTaskLabel(target);
      const afterDone = (target.sdd?.steps || []).filter((step) => step.done).length;
      if (afterTask === beforeTask && afterDone <= beforeDone) {
        const autoUpdated = await markCurrentTaskCompleted(target, beforeTask, result.summary);
        if (autoUpdated) {
          await refreshProjectState(target);
          appendOperationalLog(
            target,
            `Ho aggiornato automaticamente .lc/spec/tasks.md: completato "${beforeTask}".`,
          );
          pushAssistantMessage(
            target,
            `Ho completato il task "${beforeTask}" e ho aggiornato automaticamente il piano SDD. Puoi continuare dal prossimo task.`,
          );
          stallCount = 0;
        } else {
          stallCount += 1;
        }
      } else {
        stallCount = 0;
      }

      if (stallCount >= 2) {
        throw new Error(
          `Il task "${beforeTask}" non risulta avanzare: il modello ha scritto file, ma non ha aggiornato il piano SDD marcando il task completato. Correggi .lc/spec/tasks.md oppure riprova con un modello diverso.`,
        );
      }

      turns += 1;
    }

    if (turns >= maxTurns && target.sdd?.currentStep) {
      throw new Error("Limite di sicurezza raggiunto: ho eseguito molti task senza arrivare alla fine del piano SDD.");
    }

    await finishAutopilot(target, apps);
  } catch (err) {
    await stopAutopilotWithError(target, apps, err, model);
  }
}

async function finishAutopilot(target, apps) {
  await refreshProjectState(target);
  const steps = target.sdd?.steps || [];
  const doneCount = steps.filter((step) => step.done).length;
  const now = new Date().toISOString();
  appendOperationalLog(
    target,
    target.sdd?.currentStep
      ? `In pausa. Prossimo task: ${target.sdd.currentStep.label}.`
      : "Piano SDD completato.",
  );
  target.status = target.sdd?.currentStep ? "paused" : "ready";
  target.updatedAt = now;
  target.autopilot = {
    ...(target.autopilot || {}),
    running: false,
    currentTask: target.sdd?.currentStep?.label || "Piano SDD completato",
    completed: doneCount,
    total: steps.length,
    updatedAt: now,
    lastMessage: target.sdd?.currentStep ? "Autopilota in pausa." : "Tutti i task SDD risultano completati.",
    error: null,
  };
  pushAssistantMessage(
    target,
    target.sdd?.currentStep
      ? `Autopilota in pausa. Prossimo task: ${target.sdd.currentStep.label}.`
      : "Autopilota completato: il piano SDD risulta completato e la preview e stata aggiornata.",
  );
  await saveApps(apps);
}

async function stopAutopilotWithError(target, apps, err, model) {
  const message = formatOpenRouterError(err);
  await refreshProjectState(target);
  const task = target.autopilot?.currentTask || getNextTaskLabel(target) || "Task SDD corrente";
  const now = new Date().toISOString();
  appendOperationalLog(target, `Errore nel task "${task}": ${message}`);
  target.status = "error";
  target.updatedAt = now;
  target.autopilot = {
    ...(target.autopilot || {}),
    running: false,
    currentTask: task,
    updatedAt: now,
    lastMessage: "Fermo per errore.",
    error: buildOperationalError({ task, message, model }),
  };
  pushAssistantMessage(
    target,
    `Errore nel task "${task}" con ${model}: ${message}\n\nCosa fare: leggi il registro operativo, correggi la causa indicata e premi Riprendi quando sei pronto.`,
  );
  await saveApps(apps);
}

function buildOperationalError({ task, message, model }) {
  const lower = String(message || "").toLowerCase();
  let suggestion = "Correggi la causa indicata e poi usa Riprendi: l'orchestrator continuera dal task fermo.";
  if (lower.includes("api key") || lower.includes("401") || lower.includes("unauthorized")) {
    suggestion = "Controlla la API key OpenRouter nelle impostazioni e riprova.";
  } else if (lower.includes("429") || lower.includes("rate")) {
    suggestion = "OpenRouter ha limitato le richieste. Attendi qualche minuto o cambia modello tra DeepSeek e Kimi.";
  } else if (lower.includes("json non valido") || lower.includes("risposta vuota")) {
    suggestion = "Il provider ha chiuso o troncato la risposta. Riprova: i file gia salvati restano nel progetto.";
  } else if (lower.includes("blocchi file")) {
    suggestion = "Il modello non ha restituito file nel formato richiesto. Riprova oppure passa all'altro modello disponibile.";
  }

  return {
    title: "Orchestrator fermo",
    task,
    model,
    cause: message,
    suggestion,
  };
}

function appendOperationalLog(target, message) {
  if (!message) return;

  const previous = Array.isArray(target.autopilot?.log) ? target.autopilot.log : [];
  target.autopilot = {
    ...(target.autopilot || {}),
    log: [
      ...previous,
      {
        at: new Date().toISOString(),
        message,
      },
    ].slice(-18),
  };
}

async function markCurrentTaskCompleted(target, taskLabel, note = "") {
  const tasksPath = ".lc/spec/tasks.md";
  const current = await readProjectFile(target.id, tasksPath);
  if (!current.trim()) return false;

  const escaped = escapeRegExp(String(taskLabel || "").trim());
  let changed = false;
  let next = current;

  if (escaped) {
    const exactPattern = new RegExp(`^(\\s*[-*]\\s+\\[)\\s(\\]\\s+.*${escaped}.*)$`, "im");
    next = next.replace(exactPattern, (_match, prefix, suffix) => {
      changed = true;
      return `${prefix}x${suffix}`;
    });
  }

  if (!changed) {
    next = next.replace(/^(\s*[-*]\s+\[)\s(\]\s+.+)$/m, (_match, prefix, suffix) => {
      changed = true;
      return `${prefix}x${suffix}`;
    });
  }

  if (!changed || next === current) return false;

  await writeProjectFile(target.id, tasksPath, next);

  const memoryPath = ".lc/memory/project_context.md";
  const memory = await readProjectFile(target.id, memoryPath);
  const stamp = new Date().toISOString();
  const cleanNote = String(note || "").replace(/\s+/g, " ").slice(0, 500);
  await writeProjectFile(
    target.id,
    memoryPath,
    `${memory.trim()}\n\n---\n\n## Avanzamento automatico ${stamp}\n\nTask completato: ${taskLabel || "prossimo task SDD"}.\n${cleanNote ? `\nNota: ${cleanNote}\n` : ""}`,
  );

  return true;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pushAssistantMessage(target, content) {
  target.messages = Array.isArray(target.messages) ? target.messages : [];
  target.messages.push({
    role: "assistant",
    content,
    at: new Date().toISOString(),
  });
}

async function runOrchestratorTurn({ target, apiKey, model, userPrompt, mode, onProgress }) {
  if (mode === "initial") {
    return runInitialOrchestration({ target, apiKey, model, userPrompt, onProgress });
  }

  const projectMemory = await loadProjectMemory(target);
  const nextTask = getNextTaskLabel(target);
  const systemPrompt = buildOrchestratorSystemPrompt();
  const prompt = buildFollowupOrchestratorPrompt({ userPrompt, projectMemory, nextTask, mode });

  const aiText = await callOpenRouter({
    apiKey,
    model,
    systemPrompt,
    userPrompt: prompt,
    maxTokens: 9000,
    timeoutMs: openRouterTimeoutMs,
  });

  const operations = parseOperations(aiText);
  if (!operations.length) {
    throw new Error(
      "Il modello ha risposto, ma non ha restituito blocchi file applicabili. L'orchestrator web richiede blocchi ```file path=\"...\".",
    );
  }

  const result = await applyOperations(target.id, operations);
  if (result.errors.length) {
    throw new Error(`Operazioni file non valide: ${result.errors.join("; ")}`);
  }

  await refreshProjectState(target);
  await onProgress?.();

  const createdOrUpdated = [...result.created, ...result.updated];
  const action =
    mode === "initial"
      ? "SDD creato e primo MVP generato"
      : mode === "continue"
        ? "Prossimo task SDD applicato"
        : "Modifica applicata seguendo SDD";

  return {
    summary: `${action} con ${model}. File aggiornati: ${createdOrUpdated.slice(0, 8).join(", ")}${createdOrUpdated.length > 8 ? "..." : ""}.`,
  };
}

async function runInitialOrchestration({ target, apiKey, model, userPrompt, onProgress }) {
  const systemPrompt = buildOrchestratorSystemPrompt();
  const phases = [
    {
      label: "specifiche SDD",
      maxTokens: 7000,
      getPrompt: async () => buildInitialSpecsPrompt(userPrompt),
    },
    {
      label: "backend e deploy",
      maxTokens: 7500,
      getPrompt: async () => buildInitialBackendPrompt(userPrompt, await loadProjectMemory(target)),
    },
    {
      label: "frontend e anteprima",
      maxTokens: 9500,
      getPrompt: async () => buildInitialFrontendPrompt(userPrompt, await loadProjectMemory(target)),
    },
  ];

  const touched = [];

  for (const phase of phases) {
    const aiText = await callOpenRouter({
      apiKey,
      model,
      systemPrompt,
      userPrompt: await phase.getPrompt(),
      maxTokens: phase.maxTokens,
      timeoutMs: openRouterTimeoutMs,
    });

    const operations = parseOperations(aiText);
    if (!operations.length) {
      throw new Error(
        `Fase ${phase.label}: il modello ha risposto, ma non ha restituito blocchi file applicabili.`,
      );
    }

    const result = await applyOperations(target.id, operations);
    if (result.errors.length) {
      throw new Error(`Fase ${phase.label}: operazioni file non valide: ${result.errors.join("; ")}`);
    }

    touched.push(...result.created, ...result.updated);
    await refreshProjectState(target);
    target.updatedAt = new Date().toISOString();
    await onProgress?.(phase.label);
  }

  return {
    summary: `SDD creato e MVP iniziale generato con ${model}. File aggiornati: ${[...new Set(touched)].slice(0, 10).join(", ")}${touched.length > 10 ? "..." : ""}.`,
  };
}

function buildOrchestratorSystemPrompt() {
  return [
    "Sei LocoCode Web, un SDD Orchestrator per creare web app complete.",
    "Non sei una chat generica: lavori per specifiche, task piccoli e file reali.",
    "",
    "Stack predefinito:",
    "- Frontend: React + Vite",
    "- Backend: FastAPI",
    "- Database iniziale: SQLite",
    "- Deploy backend: Render",
    "- Provider AI: OpenRouter",
    "",
    "Regole:",
    "- Rispondi in italiano nei documenti SDD.",
    "- Non fare domande bloccanti quando puoi scegliere una soluzione ragionevole.",
    "- Non inserire API key o segreti nei file.",
    "- Ogni modifica deve restituire file completi, non patch parziali.",
    "- Usa solo percorsi relativi alla root progetto.",
    "- Per la preview web devi sempre creare o aggiornare preview/index.html come file HTML singolo con CSS e JS inline, senza CDN e senza asset remoti.",
    "- Se generi backend, includi sempre backend/requirements.txt, backend/app/__init__.py, backend/app/main.py e backend/.env.example.",
    "- Aggiorna .lc/spec/tasks.md spuntando i task completati.",
    "",
    "Formato obbligatorio per creare/modificare file:",
    "```file path=\"percorso/relativo/file.ext\"",
    "contenuto completo del file",
    "```",
    "",
    "Puoi restituire piu blocchi file nella stessa risposta. Evita testo lungo fuori dai blocchi.",
  ].join("\n");
}

function buildInitialSpecsPrompt(initialPrompt) {
  return [
    "Richiesta iniziale utente:",
    initialPrompt,
    "",
    "FASE 1/3 - Specifiche SDD.",
    "Genera solo documenti di progetto e piano operativo. Non generare ancora codice applicativo.",
    "",
    "File obbligatori da restituire:",
    "- .lc/spec/sdd.md",
    "- .lc/spec/requirements.md",
    "- .lc/spec/architecture.md",
    "- .lc/spec/tasks.md",
    "- .lc/memory/project_context.md",
    "- README.md",
    "- render.yaml",
    "",
    "Il file .lc/spec/tasks.md deve contenere checkbox markdown con task piccoli e verificabili.",
    "Marca completati solo i task di specifica realmente coperti in questa fase.",
    "Se il dominio e medico/dentistico, il prodotto deve gestire processi amministrativi e clinici registrati dallo studio, ma non deve dare diagnosi o consigli medici automatici.",
    "Restituisci solo blocchi file.",
  ].join("\n");
}

function buildInitialBackendPrompt(initialPrompt, projectMemory) {
  return [
    "Richiesta iniziale utente:",
    initialPrompt,
    "",
    "FASE 2/3 - Backend, database e deploy.",
    "Usa la memoria SDD qui sotto e genera i file backend completi per FastAPI + SQLite.",
    "",
    "Memoria progetto:",
    projectMemory,
    "",
    "File obbligatori da restituire:",
    "- backend/requirements.txt",
    "- backend/app/__init__.py",
    "- backend/app/main.py",
    "- backend/.env.example",
    "- .lc/spec/tasks.md",
    "- .lc/memory/project_context.md",
    "",
    "backend/app/main.py deve includere FastAPI, CORS, health check, modelli Pydantic, inizializzazione SQLite e API CRUD minime coerenti con il progetto.",
    "Non inserire dati sanitari reali, API key o segreti.",
    "Aggiorna i task SDD completati in questa fase.",
    "Restituisci solo blocchi file.",
  ].join("\n");
}

function buildInitialFrontendPrompt(initialPrompt, projectMemory) {
  return [
    "Richiesta iniziale utente:",
    initialPrompt,
    "",
    "FASE 3/3 - Frontend React e anteprima.",
    "Usa la memoria SDD qui sotto e genera il frontend MVP completo.",
    "",
    "Memoria progetto:",
    projectMemory,
    "",
    "File obbligatori da restituire:",
    "- frontend/package.json",
    "- frontend/index.html",
    "- frontend/src/App.jsx",
    "- frontend/src/styles.css",
    "- preview/index.html",
    "- .lc/spec/tasks.md",
    "- .lc/memory/project_context.md",
    "",
    "Il frontend deve essere in italiano, gestionale, responsive, con dati demo realistici ma fittizi.",
    "preview/index.html deve essere un HTML singolo con CSS e JS inline, senza CDN e senza asset remoti, cosi la preview funziona subito nell'iframe.",
    "Aggiorna i task SDD completati in questa fase.",
    "Restituisci solo blocchi file.",
  ].join("\n");
}

function buildFollowupOrchestratorPrompt({ userPrompt, projectMemory, nextTask, mode }) {
  const instruction =
    mode === "continue"
      ? `Continua automaticamente dal prossimo task SDD: ${nextTask || "completa il prossimo passo tecnico utile"}.`
      : `Applica questa richiesta utente seguendo la memoria SDD: ${userPrompt}`;

  return [
    instruction,
    "",
    "Memoria progetto disponibile:",
    projectMemory,
    "",
    "Istruzioni operative:",
    "- Non ripartire da zero.",
    "- Modifica solo i file necessari.",
    "- Aggiorna sempre .lc/spec/tasks.md e .lc/memory/project_context.md.",
    "- Aggiorna preview/index.html se cambia il comportamento o la UI.",
    "- Restituisci solo blocchi file nel formato richiesto.",
  ].join("\n");
}

async function createInitialWorkspace(target, initialPrompt) {
  const root = projectRoot(target.id);
  const now = new Date().toISOString();
  const safeName = safeProjectName(target.name);
  const files = {
    ".lc/project.json": JSON.stringify(
      {
        display_name: target.name,
        folder_name: safeName,
        created_at: now,
        mode: "web-sdd-orchestrator",
      },
      null,
      2,
    ),
    ".lc/spec/initial_prompt.md": `# Prompt iniziale\n\nGenerato da LocoCode il ${now}.\n\n${initialPrompt}\n`,
    ".lc/state.json": JSON.stringify(
      {
        updated_at: now,
        phase: "idea_iniziale",
        label: "Fase: idea iniziale",
        has_sdd: false,
        has_requirements: false,
        has_architecture: false,
        has_tasks: false,
      },
      null,
      2,
    ),
    ".lc/memory/project_context.md": `# Project Context\n\nGenerato da LocoCode il ${now}.\n\n## Prompt iniziale\n\n${initialPrompt}\n`,
    ".gitignore": ["node_modules/", "dist/", "build/", ".env", "__pycache__/", "*.pyc", ".lc/tmp/"].join("\n"),
  };

  for (const [relPath, content] of Object.entries(files)) {
    await writeProjectFile(target.id, relPath, content);
  }
}

async function refreshProjectState(target) {
  const root = projectRoot(target.id);
  const files = await listProjectFiles(root);
  target.files = files;
  target.fileCount = files.length;
  target.html = await readPreviewHtml(target);

  const specs = {
    sdd: await readProjectFile(target.id, ".lc/spec/sdd.md"),
    requirements: await readProjectFile(target.id, ".lc/spec/requirements.md"),
    architecture: await readProjectFile(target.id, ".lc/spec/architecture.md"),
    tasks: await readProjectFile(target.id, ".lc/spec/tasks.md"),
    memory: await readProjectFile(target.id, ".lc/memory/project_context.md"),
  };
  const steps = parseTaskList(specs.tasks);
  const currentStep = steps.find((step) => !step.done) || null;

  target.sdd = {
    specs,
    steps,
    currentStep,
    filePaths: [
      ".lc/spec/sdd.md",
      ".lc/spec/requirements.md",
      ".lc/spec/architecture.md",
      ".lc/spec/tasks.md",
      ".lc/memory/project_context.md",
    ].filter((relPath) => files.includes(relPath)),
  };
  target.phase = currentStep ? "building" : "ready";
}

async function loadProjectMemory(target) {
  const root = projectRoot(target.id);
  const files = await listProjectFiles(root);
  const memoryFiles = [
    ".lc/spec/requirements.md",
    ".lc/spec/architecture.md",
    ".lc/spec/tasks.md",
    ".lc/memory/project_context.md",
    "README.md",
  ];

  const chunks = [];
  for (const relPath of memoryFiles) {
    const content = await readProjectFile(target.id, relPath);
    if (content.trim()) {
      chunks.push(`--- FILE: ${relPath} ---\n${truncate(content, 9000)}`);
    }
  }

  chunks.push(`--- FILE LIST ---\n${files.join("\n") || "Nessun file ancora."}`);
  return truncate(chunks.join("\n\n"), 36000);
}

function parseOperations(responseText) {
  if (!responseText) return [];

  const operations = [];
  operations.push(...parseJsonOperations(responseText));
  operations.push(...parseFencedFileBlocks(responseText));
  operations.push(...parseXmlFileTags(responseText));

  const seen = new Set();
  return operations.filter((operation) => {
    const key = `${operation.action || "write"}:${operation.path}:${operation.content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseFencedFileBlocks(text) {
  const operations = [];
  const fencePattern = /```(?<header>[^\n`]*)\n(?<body>[\s\S]*?)```/gi;
  for (const match of text.matchAll(fencePattern)) {
    const header = (match.groups?.header || "").trim();
    const pathValue = extractPathFromHeader(header);
    if (!pathValue) continue;
    operations.push({
      path: pathValue,
      action: extractActionFromHeader(header) || "write",
      content: `${(match.groups?.body || "").replace(/\s+$/g, "")}\n`,
      source: "fenced",
    });
  }

  const unclosed = text.match(/```(?<header>[^\n`]*)\n(?<body>[\s\S]*)$/i);
  if (unclosed?.groups) {
    const pathValue = extractPathFromHeader(unclosed.groups.header || "");
    if (pathValue && !operations.some((operation) => operation.path === pathValue)) {
      operations.push({
        path: pathValue,
        action: extractActionFromHeader(unclosed.groups.header || "") || "write",
        content: `${(unclosed.groups.body || "").replace(/\s+$/g, "")}\n`,
        source: "fenced-unclosed",
      });
    }
  }

  return operations;
}

function parseXmlFileTags(text) {
  const operations = [];
  const tagPattern =
    /<file\s+path=["'](?<path>[^"']+)["'](?:\s+action=["'](?<action>[^"']+)["'])?\s*>(?<body>[\s\S]*?)<\/file>/gi;

  for (const match of text.matchAll(tagPattern)) {
    operations.push({
      path: (match.groups?.path || "").trim(),
      action: (match.groups?.action || "write").trim(),
      content: `${(match.groups?.body || "").trimEnd()}\n`,
      source: "xml",
    });
  }

  return operations;
}

function parseJsonOperations(text) {
  const operations = [];
  const jsonBlocks = [];
  const fencePattern = /```(?:json|lococode-json)?\s*\n(?<body>\{[\s\S]*?\})\s*```/gi;

  for (const match of text.matchAll(fencePattern)) {
    if (match.groups?.body) jsonBlocks.push(match.groups.body);
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) jsonBlocks.push(trimmed);

  for (const block of jsonBlocks) {
    try {
      const data = JSON.parse(block);
      if (!Array.isArray(data.files)) continue;
      for (const item of data.files) {
        if (!item || typeof item !== "object") continue;
        const pathValue = String(item.path || "").trim();
        if (!pathValue) continue;
        operations.push({
          path: pathValue,
          action: String(item.action || "write").trim(),
          content: String(item.content || ""),
          source: "json",
        });
      }
    } catch {
      // Ignore non-file JSON snippets.
    }
  }

  return operations;
}

function extractPathFromHeader(header) {
  const patterns = [
    /(?:path|file|filename)\s*=\s*"([^"]+)"/i,
    /(?:path|file|filename)\s*=\s*'([^']+)'/i,
    /(?:path|file|filename)\s*=\s*([^\s]+)/i,
    /(?:file|lococode-file)\s+([^\s]+)/i,
  ];

  for (const pattern of patterns) {
    const found = header.match(pattern);
    if (found?.[1]) return found[1].trim();
  }

  return "";
}

function extractActionFromHeader(header) {
  const patterns = [/action\s*=\s*"([^"]+)"/i, /action\s*=\s*'([^']+)'/i, /action\s*=\s*([^\s]+)/i];
  for (const pattern of patterns) {
    const found = header.match(pattern);
    if (found?.[1]) return found[1].trim();
  }
  return "write";
}

async function applyOperations(appId, operations) {
  const root = projectRoot(appId);
  await fs.mkdir(root, { recursive: true });

  const result = {
    created: [],
    updated: [],
    skipped: [],
    errors: [],
    totalOperations: operations.length,
  };

  for (const operation of operations) {
    const relPath = normalizeSafePath(operation.path);
    if (!relPath) {
      result.errors.push(`Percorso non sicuro o vuoto: ${operation.path || ""}`);
      continue;
    }

    const targetPath = path.join(root, relPath);
    const existed = await exists(targetPath);
    const action = String(operation.action || "write").toLowerCase();

    try {
      if (["write", "create", "overwrite", "update"].includes(action)) {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, String(operation.content || ""), "utf8");
        if (existed) result.updated.push(relPath);
        else result.created.push(relPath);
      } else if (["delete", "remove"].includes(action)) {
        if (existed) {
          await fs.unlink(targetPath);
          result.updated.push(`deleted:${relPath}`);
        } else {
          result.skipped.push(`File non trovato: ${relPath}`);
        }
      } else {
        result.skipped.push(`Azione non supportata '${action}' per ${relPath}`);
      }
    } catch (err) {
      result.errors.push(`Errore su ${relPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

async function callOpenRouter({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  maxTokens = 12000,
  timeoutMs = openRouterTimeoutMs,
}) {
  const shouldAbort = Number(timeoutMs) > 0;
  const controller = shouldAbort ? new AbortController() : null;
  const timeout = shouldAbort ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller?.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://lococode.local",
        "X-Title": "LocoCode",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.22,
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${raw.slice(0, 600)}`);
    }

    if (!raw.trim()) {
      throw new Error("OpenRouter ha restituito una risposta vuota.");
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`OpenRouter ha restituito JSON non valido o troncato: ${raw.slice(0, 220)}`);
    }

    return data.choices?.[0]?.message?.content || "";
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function loadSettings() {
  const defaults = {
    openrouterApiKey: "",
    defaultModel: commonModels[0],
  };

  const own = await readJson(configPath);
  if (own) {
    return {
      ...defaults,
      ...own,
      defaultModel: normalizeModelId(own.defaultModel || defaults.defaultModel),
    };
  }

  const legacy = await readJson(legacyConfigPath);
  if (!legacy) return defaults;

  return {
    openrouterApiKey: legacy.openrouter_api_key || "",
    defaultModel: defaults.defaultModel,
  };
}

async function loadApps() {
  const data = await readJson(appsPath);
  return Array.isArray(data?.apps) ? data.apps : [];
}

async function saveApps(apps) {
  await fs.writeFile(appsPath, JSON.stringify({ apps }, null, 2), "utf8");
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function publicApp(appData) {
  return {
    ...appData,
    html: appData.html || "",
    files: Array.isArray(appData.files) ? appData.files : [],
    fileCount: appData.fileCount || (Array.isArray(appData.files) ? appData.files.length : 0),
    sdd: appData.sdd || emptySddState(),
    storagePath: projectRoot(appData.id),
  };
}

function emptySddState() {
  return {
    specs: {
      sdd: "",
      requirements: "",
      architecture: "",
      tasks: "",
      memory: "",
    },
    steps: [],
    currentStep: null,
    filePaths: [],
  };
}

function formatOpenRouterError(err) {
  if (err?.name === "AbortError") {
    if (openRouterTimeoutMs > 0) {
      return `Timeout: ${Math.round(openRouterTimeoutMs / 1000)} secondi non sono bastati per completare la generazione con questo modello.`;
    }
    return "La richiesta e stata interrotta dal client o dalla connessione, non dal timeout interno di LocoCode.";
  }

  if (err instanceof Error) return err.message;
  return String(err);
}

async function readPreviewHtml(target) {
  const preview = await readProjectFile(target.id, "preview/index.html");
  if (preview.trim()) return preview;

  const rootIndex = await readProjectFile(target.id, "index.html");
  if (looksLikeStandaloneHtml(rootIndex)) return rootIndex;

  return target.html || "";
}

function looksLikeStandaloneHtml(value) {
  return /<!doctype html|<html[\s>]/i.test(value || "");
}

async function readProjectFile(appId, relPath) {
  const safe = normalizeSafePath(relPath);
  if (!safe) return "";

  try {
    return await fs.readFile(path.join(projectRoot(appId), safe), "utf8");
  } catch {
    return "";
  }
}

async function writeProjectFile(appId, relPath, content) {
  const safe = normalizeSafePath(relPath);
  if (!safe) throw new Error(`Percorso non sicuro: ${relPath}`);
  const targetPath = path.join(projectRoot(appId), safe);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf8");
}

async function listProjectFiles(root) {
  if (!(await exists(root))) return [];

  const results = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (["node_modules", "dist", "build", "__pycache__"].includes(entry.name)) continue;
        await walk(full);
      } else {
        results.push(rel);
      }
    }
  }

  await walk(root);
  return results.sort((a, b) => a.localeCompare(b));
}

function projectRoot(appId) {
  return path.join(projectsDir, appId);
}

function normalizeSafePath(relPath) {
  const normalized = String(relPath || "").replaceAll("\\", "/").trim();
  if (!normalized) return "";
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("/")) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.includes("..")) return "";
  return parts.join("/");
}

function parseTaskList(tasksMarkdown) {
  if (!tasksMarkdown) return [];

  const steps = [];
  const lines = tasksMarkdown.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s+\[(?<mark>[ xX])\]\s+(?<label>.+)$/);
    if (!match?.groups) continue;

    const rawLabel = match.groups.label
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .replace(/\s+/g, " ")
      .trim();

    steps.push({
      id: `task-${steps.length + 1}`,
      label: rawLabel,
      done: match.groups.mark.toLowerCase() === "x",
    });
  }

  return steps;
}

function getNextTaskLabel(target) {
  const step = target?.sdd?.steps?.find((item) => !item.done);
  return step?.label || "";
}

function titleFromPrompt(prompt) {
  const words = prompt.match(/[A-Za-zÀ-ÿ0-9]+/g) || ["LocoCode", "App"];
  return words
    .slice(0, 4)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function safeProjectName(name) {
  const cleaned = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "nuovo-progetto-lococode";
}

function normalizeModelId(model) {
  const raw = String(model || "").trim();
  const lower = raw.toLowerCase();
  const aliases = {
    deepseek: "deepseek/deepseek-v4-pro",
    "deepseek pro": "deepseek/deepseek-v4-pro",
    "deepseek v4 pro": "deepseek/deepseek-v4-pro",
    kimi: "moonshotai/kimi-k2.6",
    "kimi k2.6": "moonshotai/kimi-k2.6",
    moonshot: "moonshotai/kimi-k2.6",
  };
  const normalized = aliases[lower] || raw || commonModels[0];
  return commonModels.includes(normalized) ? normalized : commonModels[0];
}

function truncate(value, maxChars) {
  const text = String(value || "");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[CONTESTO TAGLIATO]` : text;
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
