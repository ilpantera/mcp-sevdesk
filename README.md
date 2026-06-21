# mcp-sevdesk

MCP-Server für sevDesk, optimiert für **sevDesk Update 2.0 / aktuelle OpenAPI**.
Der Fokus liegt auf agent-tauglichen Buchhaltungsworkflows statt auf maximal generischen CRUD-Aufrufen.

## Positionierung

- **Update-2.0-first**: High-Level-Flows orientieren sich an `taxRule`, Receipt Guidance und den aktuellen Status-Workflows.
- **Keine v1-Workflow-Kompatibilität als Ziel**: alte `taxType`-/`taxSet`-Denke wird nicht mehr aktiv unterstützt.
- **HTTP-Basis bleibt technisch** `https://my.sevdesk.de/api/v1`, obwohl das Verhalten fachlich auf Update 2.0 ausgerichtet ist.
- sevDesk veröffentlicht die aktuellen Update-2.0-Funktionen weiterhin unter dieser `/api/v1`-Basis; dieses Repository richtet daher die Semantik auf Update 2.0 aus, ohne eine andere technische Base-URL zu erzwingen.
- **Agent-freundlich**: Toolbeschreibungen markieren klar, ob ein Tool lesend, schreibend, low-level oder irreversibel ist.

## Schwerpunkt-Workflows

- Voucher / Eingangsbelege
- Voucher-Positionen / Buchungskonten
- Receipt Guidance
- Kontakte / Lieferanten
- Parts / Artikel
- Bankkonten / Transaktionen
- Rechnungen / Gutschriften / Orders (low-level, Update-2.0-konform beschrieben)

## Installation

```bash
npm install
npm run generate-types
npm run build
```

## Konfiguration

Setze `SEVDESK_API_TOKEN`:

```bash
export SEVDESK_API_TOKEN="dein-token"
```

## Verwendung

### Als MCP-Server

```json
{
  "mcpServers": {
    "sevdesk": {
      "command": "node",
      "args": ["/pfad/zu/mcp-sevdesk/dist/index.js"],
      "env": {
        "SEVDESK_API_TOKEN": "dein-token"
      }
    }
  }
}
```

### Direkt ausführen

```bash
SEVDESK_API_TOKEN="dein-token" npm start
```

## Tool-Übersicht

### Voucher / Receipt Guidance

| Tool | Typ | Zweck |
|---|---|---|
| `get_voucher_positions_batch` | read | Strukturierte Batch-Abfrage für Belegpositionen |
| `check_and_extract_einvoice_batch` | read | Batch-Prüfung für ZUGFeRD/XRechnung |
| `get_voucher_booking_context` | read | Voucher-Header, Positionen, E-Invoice und optional Bild in einem Aufruf |
| `get_voucher_booking_context_batch` | read | Strukturierte Batch-Variante des Booking Context |
| `validate_voucher_booking_plan` | read | Strikte lokale Validierung eines Voucher-Buchungsplans, optional mit Receipt Guidance |
| `apply_voucher_booking_plan` | write | Empfohlenes High-Level-Tool für konsistente Voucher-Buchung |
| `get_receipt_guidance` | read | Erlaubte Konto-/TaxRule-/TaxRate-Kombinationen aus sevDesk |
| `update_voucher` | write / low-level | Nur Header-Metadaten, **nicht** für Statuswechsel |
| `reset_voucher_to_draft` | write | Status gezielt auf Draft zurücksetzen |
| `reset_voucher_to_open` | write | Status gezielt auf Open zurücksetzen |
| `enshrine_voucher` | write / irreversibel | Voucher rechtssicher festschreiben |
| `update_voucher_position` | write / low-level | Einzelne Position direkt anpassen |
| `create_voucher_position` | write / low-level | Einzelne Position direkt hinzufügen |
| `delete_voucher_position` | write / low-level | Einzelne Position löschen |

### Kontakte

| Tool | Typ | Zweck |
|---|---|---|
| `list_contacts` | read | Kontakte mit Filtern, inkl. optionaler Kategorie |
| `list_supplier_contacts` | read | Lieferantenkontakte für Voucher-Workflows |
| `find_contact_by_exact_or_alias_name` | read | Exakt-/Alias-Namenssuche für Supplier-Normalisierung |
| `get_contact` / `create_contact` / `update_contact` / `delete_contact` | mixed | Basisoperationen für Kontakte |

### Parts / Artikel

| Tool | Typ | Zweck |
|---|---|---|
| `list_parts` / `get_part` | read | Artikel lesen |
| `find_part_by_number_or_name` | read | Artikel-Lookup für Agenten |
| `create_part` / `update_part` / `delete_part` | write | Artikel pflegen |
| `get_part_stock` | read | Lagerbestand lesen |

### Banking / Check Accounts

| Tool | Typ | Zweck |
|---|---|---|
| `list_check_accounts` / `get_check_account` / `get_check_account_balance` | read | Bank-/Kassenkonten lesen |
| `list_transactions` / `get_transaction` | read | Transaktionen lesen |
| `create_transaction` / `update_transaction` / `delete_transaction` | write | Transaktionen pflegen |
| `enshrine_transaction` | write / irreversibel | Transaktion unwiderruflich festschreiben |

### Rechnungen / Gutschriften / Orders

Diese Bereiche bleiben bewusst **low-level**. Für Update 2.0 werden Statuswechsel nicht über freie Statusfelder modelliert, sondern über sevDesk-spezifische Aktionen wie `send`, `book`, `cancel`.

### Sonstiges

- Tags
- Reports

## Voucher-Booking-Plan (empfohlener Workflow)

Für moderne Eingangsbeleg-Workflows ist `apply_voucher_booking_plan` das zentrale Tool.

### Eingabe

- `voucherId`
- optionale Header-Felder: `supplierName`, `taxRuleId`, `voucherDate`, `description`
- `expectedTotalGross`
- `positions[]` mit mindestens:
  - `voucherPosIdToReuse?`
  - `accountDatevId`
  - `taxRate`
  - `sumNet`
  - `sumGross?`
  - `comment`
  - optional: `isAsset`, `assetUsefulLife`, `specialAccountingField3`, `cateringTip`
- optionale Ausführungsflags:
  - `dryRun`
  - `deleteSurplusPositions`

### Verhalten

1. aktuellen Voucher + Positionen laden
2. Plan lokal validieren
3. Receipt Guidance für den Belegbetrag prüfen
4. Header-/Positionsänderungen planen
5. Positionen wiederverwenden, anlegen und optional löschen
6. Endzustand erneut lesen
7. strukturiertes Ergebnis zurückgeben

### Strukturierte Ergebnisse

`apply_voucher_booking_plan` liefert u. a.:

- `ok`
- `validation`
- `receiptGuidance`
- `appliedChanges`
- `finalVoucher`
- `finalPositions`
- `warnings`
- `errors`

## Validierungsregeln für Voucher-Pläne

Der Validator ist bewusst konservativ:

- Brutto-/Netto-/Steuersatz-Berechnung wird streng geprüft
- `expectedTotalGross` muss zur Summe der Positionen passen
- `accountDatevId` ist Pflicht
- Anlageposition ohne `assetUsefulLife` ist ein Fehler
- 0%-Positionen ohne erkennbare Begründung erzeugen Warnings
- Trinkgeld-/Bewirtungsfelder werden auf Plausibilität geprüft
- Receipt Guidance kann unzulässige Konto-/TaxRule-/TaxRate-Kombinationen früh erkennen

## Fachliche Leitplanken

### `taxRule` statt `taxType`

- Für Update-2.0-Workflows soll `taxRule` explizit übergeben werden.
- `taxType` und `taxSet` werden nicht mehr als primäre Agent-Eingaben empfohlen.
- Grobe Heuristiken wie `supplierCountry -> taxRule` werden nicht mehr verwendet.

### Receipt Guidance zuerst

`get_receipt_guidance` bzw. die integrierte Receipt-Guidance-Prüfung helfen, ungültige Kombinationen vor dem Schreibversuch zu erkennen.

### Statuslogik bei Vouchern

- `update_voucher` ist **kein** generisches Status-Tool
- nutze stattdessen:
  - `reset_voucher_to_draft`
  - `reset_voucher_to_open`
  - `enshrine_voucher`
  - `book_voucher`

### Irreversible Aktionen

Folgende Tools sind fachlich kritisch und nicht rückgängig zu machen:

- `enshrine_voucher`
- `enshrine_transaction`

## Hinweise für Nutzer früherer Flows

- Alte Flows mit `taxType` als primärer Agent-Eingabe sollten auf `taxRule` umgestellt werden.
- `update_voucher` setzt keine Status mehr.
- Supplier-Country-Steuerheuristiken wurden entfernt.
- Für mehrstufige Voucher-Bearbeitung sollte `apply_voucher_booking_plan` statt loser Toolketten verwendet werden.

## Entwicklung

```bash
npm test
npm run build
```

## Lizenz

MIT
