# Ciclo di vita app MelluCode

Questo documento descrive come un creator deve poter gestire una app generata.

## Stato implementato

Ogni app e' un tenant MelluCode. Il creator proprietario puo':

- vedere le sue app nella Console;
- aprire il dettaglio app;
- modificare i dati gestionali dell'app:
  - nome;
  - slug URL;
  - registrazione pubblica utenti;
- eliminare l'app.

Eliminare una app cancella il tenant e, tramite cascade DB, tutti i dati collegati:
utenti finali, sessioni, entita, record, file, email log, quota AI e usage AI.
I file fisici salvati nello storage vengono rimossi best-effort.

## Modifica profonda dell'app generata

La modifica profonda non e' una semplice modifica del tenant. E' un nuovo flusso
di prodotto: l'utente chiede un cambiamento all'app gia' generata.

Esempi:

- aggiungi una pagina;
- modifica la grafica;
- aggiungi un campo ai clienti;
- cambia il flusso di prenotazione;
- aggiungi un report;
- rendi mobile una schermata;
- collega un servizio esterno.

## Flusso consigliato

1. Il creator apre la sua app e clicca "Richiedi modifica".
2. Scrive cosa vuole cambiare.
3. MelluCode analizza richiesta, codice/schema corrente e dati del tenant.
4. Se la richiesta e' ambigua, MelluCode fa domande prima di spendere token.
5. MelluCode stima costo e impatto:
   - modifica piccola;
   - modifica media;
   - modifica grande;
   - eventuale uso AI dentro l'app finale.
6. Il creator conferma.
7. L'orchestrator genera una patch in un ambiente isolato.
8. MelluCode esegue build/test automatici.
9. La preview mostra la nuova versione.
10. Il creator approva.
11. MelluCode promuove la modifica in produzione.

## Regole importanti

- Non modificare direttamente una app live senza preview.
- Ogni modifica deve creare una versione o almeno un log recuperabile.
- Se una modifica fallisce, la versione precedente resta funzionante.
- Le modifiche devono rispettare il design quality brief in
  `docs/orchestrator-design-quality.md`.
- Le modifiche ai dati devono passare dallo schema Data API, non da SQL manuale
  scritto dall'AI.
- Le modifiche che consumano AI dentro l'app finale devono usare la quota del
  tenant e non una chiave esposta al frontend.

## Endpoint futuri consigliati

- `POST /v1/tenants/:id/change-requests`
  Crea una richiesta di modifica.
- `GET /v1/tenants/:id/change-requests`
  Lista richieste e stati.
- `GET /v1/change-requests/:id`
  Dettaglio richiesta.
- `POST /v1/change-requests/:id/approve`
  Approva patch e deploy.
- `POST /v1/change-requests/:id/cancel`
  Annulla richiesta.

Stati suggeriti:

- `draft`
- `needs_clarification`
- `quoted`
- `accepted`
- `generating`
- `preview_ready`
- `failed`
- `deployed`
- `cancelled`

## Nota commerciale

La cancellazione serve al creator per rimuovere app inutili o test.
La modifica profonda e' invece una funzione a valore: puo' diventare un costo
extra, un consumo crediti o una modifica inclusa nel piano mensile.
