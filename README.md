# mcp-sevdesk

MCP-Server für sevDesk mit **v2.1 PDF-first Voucher-Workflow**.
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
| `get_voucher_document_info` | read | Dokument-Metadaten eines Belegs (documentId, Dateiname, MIME-Typ, hasPdf, hasImagePreview) |
| `get_voucher_document_info_batch` | read | Batch-Variante von `get_voucher_document_info` für bis zu 50 Belege |
| `get_voucher_original_pdf` | read | Liefert das Original-PDF eines Belegs als Base64-Payload (primär via `GET /Export/voucherZip`, deterministisch gemappt) |
| `get_voucher_original_pdf_batch` | read | Batch-Variante von `get_voucher_original_pdf` für bis zu 20 Belege |
| `create_draft_voucher` | write | Erstellt einen neuen sevDesk-Entwurfsbeleg und verifiziert, dass er direkt wieder lesbar ist |
| `upload_voucher_file` | write | Lädt eine lokale PDF-Datei per `multipart/form-data` nach sevDesk hoch und liefert den Temp-File-`filename`-Hash für spätere Voucher-Flows zurück |
| `attach_pdf_to_voucher` | write | Hängt ein hochgeladenes PDF an einen bestehenden Beleg an (multipart Upload + Sichtbarkeitsprüfung) |
| `create_voucher_from_pdf` | write | Komfort-Workflow: erstellt zuerst den Entwurfsbeleg, prüft ihn und hängt erst danach das hochgeladene PDF an |
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
| `find_contact_by_exact_or_alias_name` | read | Exakt-/Alias-Namenssuche auf Basis des sevDesk-`name`-Resultsets |
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

## PDF-first Dokumentworkflow (v2.1)

Der MCP liefert Original-PDFs für Claude/Cowork als Primärartefakt. Der Voucher-Standardflow arbeitet ohne serverseitige Inhalts-Extraktionsschicht.

### Upload-Workflow für neue Belege (Cowork → MCP → sevDesk)

- Cowork/Client liest lokale PDFs selbst (Ordner-Handling bleibt **außerhalb** des MCP-Servers).
- MCP erwartet hochgeladene Payloads per `attach_pdf_to_voucher` oder dem Komfort-Workflow `create_voucher_from_pdf`.
- MCP validiert:
  - `contentBase64` vorhanden und decodierbar
  - PDF-Signatur (`%PDF`) vorhanden
- MCP arbeitet intern explizit in zwei Phasen:
  1. `create_draft_voucher`: neuen Draft/Voucher mit minimalen sicheren Headerdaten anlegen
  2. direkten Re-Read des erzeugten Vouchers zur Verifikation
  3. `attach_pdf_to_voucher`: PDF per multipart/form-data hochladen und an den bereits existierenden Voucher anhängen
  4. erneute Verifikation, dass der Voucher jetzt ein sichtbares Dokument hat
- `create_voucher_from_pdf` orchestriert genau diese zwei Phasen für agent-freundliche Client-Aufrufe.
- Der MCP normalisiert `sum`/`sumNet` intern für sevDesk-kompatible Schreiboperationen, sodass Clients die Inkonsistenz nicht selbst behandeln müssen.
- Ergebnis enthält strukturiert mindestens:
  - `ok`
  - `voucherId`
  - `documentId` (falls verfügbar)
  - `fileName`
  - `warnings`
  - `errors`
- Fehlercodes unterscheiden mindestens:
  - `VOUCHER_CREATE_FAILED`
  - `VOUCHER_VERIFY_FAILED`
  - `PDF_BASE64_INVALID` / `PDF_NOT_VALID`
  - `PDF_ATTACH_FAILED`
  - `PDF_ATTACH_VERIFY_FAILED`

Beispiel-Input:

```json
{
  "fileName": "eingangsbeleg.pdf",
  "contentBase64": "<base64-pdf>",
  "voucherDate": "2026-06-22",
  "description": "Hotelrechnung Juni",
  "supplierName": "Muster Hotel GmbH",
  "creditDebit": "D"
}
```

Primärpfad für den Dokumentabruf ist `GET /Export/voucherZip`:

1. MCP lädt den voucherZip-Export
2. dekodiert Base64 serverseitig
3. entpackt die ZIP-Einträge serverseitig
4. mappt den Eintrag deterministisch über Dateiname/Dokument-ID
5. liefert das Original-PDF als Base64-Payload an den MCP-Client

Wenn die voucherZip-Route fehlschlägt, wird ein expliziter Fallback auf `/Document/{documentId}` genutzt und als Warnung im Ergebnis markiert.

### Ablauf (empfohlene Reihenfolge)

1. Entwurfs-Belege laden: `list_vouchers(status="50")`
2. Dokument-Metadaten abrufen: `get_voucher_document_info_batch(voucherIds)`
3. PDF-Artefakte laden: `get_voucher_original_pdf_batch(voucherIds)` (oder einzeln `get_voucher_original_pdf`)
4. Claude/Cowork prüft die Original-PDFs direkt
5. Buchungsplan erstellen und validieren: `validate_voucher_booking_plan`
6. Plan schreiben: `apply_voucher_booking_plan`

### Rückgabeformat `get_voucher_original_pdf`

Bei Erfolg (`ok: true`):

```json
{
  "ok": true,
  "voucherId": 147848515,
  "data": {
    "voucherId": 147848515,
    "documentId": 123456,
    "source": "voucherZip",
    "fileName": "a1b2c3d4.pdf",
    "mimeType": "application/pdf",
    "contentBase64": "<base64-pdf>",
    "sizeBytes": 48321,
    "warnings": []
  },
  "errors": [],
  "warnings": []
}
```

Bei Fehler (`ok: false`):

```json
{
  "ok": false,
  "voucherId": 147848515,
  "data": null,
  "errors": [{ "code": "FALLBACK_NOT_PDF", "message": "..." }],
  "warnings": []
}
```

`source`:

| Wert | Bedeutung |
|---|---|
| `voucherZip` | Primärpfad `GET /Export/voucherZip` erfolgreich |
| `document-download-fallback` | voucherZip fehlgeschlagen, `/Document/{documentId}` als Fallback genutzt |

#### Fehler-Codes bei PDF-Abruf

| Code | Bedeutung |
|---|---|
| `VOUCHER_NO_DOCUMENT` | Voucher hat kein Dokument angehängt |
| `ZIP_NO_CONTENT` | voucherZip-Response enthielt keinen verwertbaren Base64-Inhalt (z. B. `content: null`) |
| `ZIP_NO_MATCH` | ZIP entpackt, aber kein Eintrag trifft das Dokument deterministisch |
| `ZIP_AMBIGUOUS_MATCH` | Mehrere ZIP-Einträge passen — keine automatische Auswahl (kein Raten) |
| `ZIP_MATCH_NOT_PDF` | ZIP-Eintrag gefunden, aber kein gültiges PDF-Format |
| `FALLBACK_NOT_PDF` | voucherZip fehlgeschlagen; Fallback-Download erfolgreich, aber Inhalt ist kein PDF (z. B. Bild) |
| `FALLBACK_FAILED` | voucherZip fehlgeschlagen; Fallback-Request ebenfalls fehlgeschlagen |

> **Hinweis:** `hasPdf`-Metadaten aus `get_voucher_document_info` sind Hinweise, keine Garantie.
> Der tatsächliche PDF-Abruf ist die maßgebliche Wahrheit. Wenn `hasPdf: false` und `FALLBACK_NOT_PDF` zurückkommt,
> ist das Dokument wahrscheinlich ein Bild — manuell in sevDesk prüfen.

### Hinweise

- Die Zuordnung eines ZIP-Eintrags erfolgt bewusst deterministisch; bei Mehrdeutigkeit wird ein Fehler statt Raten zurückgegeben.
- `get_voucher_document_info` bleibt der schnelle Metadaten-Call vor dem PDF-Download.
- Schreiboperationen (Voucher-Status, Positionen, Buchung) laufen weiter über die bestehenden MCP-Tools.

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
  - optional: `isAsset`, `assetUsefulLife` (**Monate**), `specialAccountingField3`, `cateringTip`
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
- `writePhase` (started/completedSteps/failedAt/failedMessage)
- `finalVoucher`
- `finalPositions`
- `warnings`
- `errors`

## Validierungsregeln für Voucher-Pläne

Der Validator ist bewusst konservativ:

- Brutto-/Netto-/Steuersatz-Berechnung wird streng geprüft
- `expectedTotalGross` muss zur Summe der Positionen passen
- `accountDatevId` ist Pflicht
- Anlageposition ohne `assetUsefulLife` in Monaten ist ein Fehler
- 0%-Positionen ohne erkennbare Begründung erzeugen Warnings
- Trinkgeld-/Bewirtungsfelder werden auf Plausibilität geprüft
- Receipt Guidance kann unzulässige Konto-/TaxRule-/TaxRate-Kombinationen früh erkennen

## Fachliche Leitplanken

### Datumsfelder & Formate

- Header-Datumsfelder bei Vouchern (`voucherDate`, `payDate`, `deliveryDate`, `paymentDeadline`) werden an sevDesk durchgereicht. Empfohlen: `YYYY-MM-DD` oder `YYYY-MM-DDTHH:mm:ss`.
- `book_voucher.date` und `book_invoice.date` werden ebenfalls durchgereicht. Empfohlen: `YYYY-MM-DD`; Unix-Timestamp-Strings sind nur für Setups gedacht, die sie explizit erwarten.
- `list_invoices.startDate` / `list_invoices.endDate` akzeptieren Unix-Timestamp-Strings **oder** ISO-Datum (`YYYY-MM-DD`); ISO wird im MCP auf Unix-Sekunden normalisiert.

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
