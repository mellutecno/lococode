# MelluCode generated app template

Template React generico usato dal frontendBuilder di MelluCode.

Non e' una demo palestra e non contiene logica di settore hardcoded: legge lo
schema dinamico dal backend MelluCode e costruisce lista, dettaglio e form della
primary entity scelta dall'orchestrator.

## Token sostituiti dal builder

- `__APP_NAME__`
- `__APP_SUBTITLE__`
- `__TENANT_SLUG__`
- `__BASE_PATH__`
- `__PRIMARY_ENTITY_NAME__`
- `__PRIMARY_ENTITY_LABEL__`
- `__PRIMARY_ENTITY_LABEL_PLURAL__`
- `__THEME_*__` per palette, font, glow e background

## Funzionalita'

- login utente dell'app via `mc.auth.login`
- lettura schema con `mc.entities.list`
- lista record della primary entity
- creazione, modifica, dettaglio ed eliminazione record
- upload e anteprima immagini/file con `mc.files`
- rendering automatico campi string, textarea, enum, boolean, number, date e JSON

## Sviluppo locale

Il template grezzo contiene token, quindi va copiato e sostituito prima del
build. Il test smoke di Step 3a crea una copia temporanea con valori dummy.
