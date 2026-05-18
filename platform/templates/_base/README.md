# MelluCode generated app template

Template React generico usato dal frontendBuilder di MelluCode.

Non e' una demo palestra e non contiene logica di settore hardcoded: legge lo
schema dinamico dal backend MelluCode e costruisce lista, dettaglio e form per
tutte le entita' generate dall'orchestrator.

## Token sostituiti dal builder

- `__APP_NAME__`
- `__APP_SUBTITLE__`
- `__TENANT_SLUG__`
- `__BASE_PATH__`
- `__PRIMARY_ENTITY_NAME__`
- `__PRIMARY_ENTITY_LABEL__`
- `__PRIMARY_ENTITY_LABEL_PLURAL__`
- `__APP_LAYOUT__` (operations, agenda, commerce, hospitality, showcase)
- `__THEME_*__` per palette, font, glow e background

## Funzionalita'

- login utente dell'app via `mc.auth.login`
- lettura schema con `mc.entities.list`
- navigazione fra tutte le entita' generate
- lista record per ogni entita'
- creazione, modifica, dettaglio ed eliminazione record
- upload e anteprima immagini/file con `mc.files`
- rendering automatico campi string, textarea, enum, boolean, number, date e JSON
- varianti layout per ridurre l'effetto "tutte uguali"

## Sviluppo locale

Il template grezzo contiene token, quindi va copiato e sostituito prima del
build. Il test smoke di Step 3a crea una copia temporanea con valori dummy.
