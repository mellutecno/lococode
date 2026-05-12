# LocoCode Cleanup Roadmap

## Stato attuale

Il progetto vivo e' nella cartella `lococode`.

La root deve restare piccola:

- `main.py`
- `lococode/`
- `assets/`
- `requirements.txt`
- `build_lococode_windows.bat`
- `LocoCode.spec`
- `user_data/`
- `build/` e `dist/` quando servono per il packaging

Backup, patch storiche e script temporanei sono stati spostati in:

```text
_archive_cleanup_2026-05-11/
```

Niente e' stato cancellato.

## Regola principale

Da ora in poi non aggiungere nuove patch runtime in fondo ai file.

Se una feature serve davvero, va integrata nel modulo corretto:

- UI principale: `lococode/ui/main_window.py`
- Dialog impostazioni: `lococode/ui/settings_dialog.py`
- Dialog output: `lococode/ui/output_viewer_dialog.py`
- Provider AI: `lococode/core/provider_manager.py`
- Builder/applicazione file: `lococode/core/builder_engine.py`
- Stato workspace: `lococode/core/project_workspace_manager.py`

## Problemi da risolvere in ordine

1. Stabilizzare la UI.
   - Rimuovere gradualmente le patch sovrapposte in `compact_topbar_safe.py`.
   - Evitare geometrie manuali per output e prompt.
   - Usare layout Qt normali, cosi' prompt e output non vengono tagliati.

2. Consolidare `main_window.py`.
   - Separare azioni progetto, chat/output e builder actions.
   - Lasciare `MainWindow` come coordinatore, non come contenitore di tutto.

3. Rendere il flusso tipo Lovable piu' concreto.
   - Prompt utente.
   - Risposta AI con blocchi `file path="..."`.
   - Preview file da creare/modificare.
   - Applica modifiche.
   - Verifica locale.
   - Correzione errori.

4. Eliminare logiche hardcoded vecchie.
   - `project_builder.py` e `task_runner.py` contengono ancora task Trello-specifici.
   - Vanno sostituiti con task generici derivati da `.lc/spec/tasks.md`.

5. Proteggere le API key.
   - Evitare di condividere `user_data/config.json`.
   - Valutare uso di `keyring`, gia' presente nei requirements.

## Prossimo passo consigliato

Prima milestone tecnica:

- semplificare `compact_topbar_safe.py`;
- correggere il riferimento sbagliato a `output_text`;
- rendere visibile e usabile il prompt in basso senza tagli;
- mantenere invariati provider, builder engine e salvataggio progetto.
