# MelluCode SDK

SDK JavaScript usato dai frontend generati da MelluCode.

L'obiettivo e' nascondere gli endpoint REST interni: l'app generata parla con il backend gestito tramite metodi semplici.

```js
import { MelluCode } from "mellucode-sdk";

const mc = new MelluCode({
  apiUrl: "https://mellucode.mellutecno.it",
  tenantSlug: "palestra-rossi",
});

await mc.auth.login({
  email: "admin@example.com",
  password: "admin123",
});

await mc.entities.upsert({
  name: "members",
  label: "Iscritti",
  schema: {
    required: ["fullName", "email"],
    properties: {
      fullName: { type: "string", maxLength: 120 },
      email: { type: "string", maxLength: 320 },
      active: { type: "boolean" },
    },
    additionalProperties: false,
  },
});

await mc.data("members").create({
  fullName: "Mario Rossi",
  email: "mario@example.com",
  active: true,
});

const members = await mc.data("members").list();

await mc.email.send({
  to: "cliente@example.com",
  subject: "Benvenuto",
  text: "La tua app e' pronta.",
});

const ai = await mc.ai.chat({
  messages: [{ role: "user", content: "Scrivi un riepilogo breve." }],
});
console.log(ai.reply, ai.usage.costCredits);
```

## API incluse

- `mc.auth.register({ email, password, name })`
- `mc.auth.login({ email, password })`
- `mc.auth.logout()`
- `mc.auth.me()`
- `mc.auth.changePassword({ currentPassword, newPassword })`
- `mc.entities.list()`
- `mc.entities.upsert({ name, label, schema, permissions, metadata })`
- `mc.data(entity).list({ limit, offset })`
- `mc.data(entity).get(id)`
- `mc.data(entity).create(data)`
- `mc.data(entity).update(id, data)`
- `mc.data(entity).delete(id)`
- `mc.files.upload(file, { filename, metadata })`
- `mc.files.list({ limit, offset })`
- `mc.files.get(id)`
- `mc.files.downloadBlob(id)`
- `mc.files.delete(id)`
- `mc.email.send({ to, subject, text, html, replyTo, metadata })`
- `mc.ai.chat({ messages, model, maxTokens, temperature, metadata })`
- `mc.ai.quota()`
- `mc.ai.usage({ limit })`

## Note

- Il token viene salvato in `localStorage` quando disponibile.
- In ambienti senza browser usa uno storage in memoria.
- Il refresh token viene usato automaticamente quando l'access token scade.
