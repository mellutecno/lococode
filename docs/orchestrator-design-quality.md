# MelluCode Orchestrator Design Quality Brief

Questo file e' una regola di prodotto, non una nota opzionale.

Ogni web app generata da MelluCode deve avere qualita estetica premium ispirata
ai migliori siti presenti su Awwwards, CSS Design Awards, Land-book e Godly.

## Obiettivo

L'app generata deve sembrare un prodotto vendibile: moderna, elegante,
credibile, curata nei dettagli e pronta da mostrare a un cliente.

Non generare UI base, generiche o tutte uguali. Ogni progetto deve avere una
direzione visuale coerente con il settore dell'app richiesta.

## Requisiti visivi obbligatori

- Layout pulito, ordinato e leggibile.
- Hero section forte nella prima schermata, con gerarchia visiva chiara.
- Palette coerente con il settore: non riusare sempre gli stessi colori.
- Tipografia grande, leggibile e professionale.
- Card con bordi arrotondati, ombre morbide e spaziatura generosa.
- Bottoni e call to action evidenti, belli e coerenti.
- Dashboard moderne, scansionabili, con stati chiari.
- Modali e form eleganti, facili da usare.
- Stati vuoti, loading e messaggi di errore curati graficamente.
- Micro-animazioni leggere: hover, focus, loading, transizioni.
- Responsive perfetto su mobile e desktop.
- Contrasto sempre leggibile: evitare sfondo chiaro con testo chiaro o dark UI
  con testo troppo spento.
- Coerenza tra colori, font, icone, bordi, spacing e componenti.

## Regola di varieta

La qualita deve restare fissa, ma la palette e il tono visuale devono variare.

Esempi:

- Fitness / sport: dark premium, violet/electric, energia, movimento.
- Studio medico / dentistico: pulito, chiaro, blu/teal, fiducia.
- Ristorante: warm, amber, terracotta, immagini e atmosfera.
- SaaS / gestionale: elegante, ordinato, tech, contrasto alto.
- Beauty / fashion: cream, rose, fuchsia, editorial.
- Finance / legale: navy, oro, bianco, autorevolezza.

## Regola per il prompt generator

Quando l'orchestrator genera una app, questo brief deve essere incluso nelle
istruzioni di sistema o nel blocco design del prompt. Deve essere trattato come
vincolo obbligatorio insieme ai requisiti funzionali.

Il prompt finale verso il modello che genera il frontend deve includere:

1. Il settore dell'app e il pubblico finale.
2. Una direzione visuale specifica, scelta in base al settore.
3. La richiesta esplicita di evitare UI generica o clonata da MelluCode.
4. I requisiti di contrasto e leggibilita.
5. Gli stati obbligatori: empty, loading, error, success.
6. Responsive mobile e desktop.
7. Demo utilizzabile, non solo pagine statiche decorative.

## Nota prodotto

L'utente paga per ottenere una web app che possa provare, valutare e poi
acquistare o mantenere in abbonamento. L'estetica e' parte del valore
commerciale del prodotto, quindi una UI brutta o generica e' un errore di
prodotto, non un dettaglio secondario.
