# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Owners and managers of distribution companies (pilot: the Supricom group, Venezuela). They use ORA in equal measure on a desktop computer for multi-minute analysis sessions and on a phone for quick checks of headline figures. They read money in USD and occasionally VEF, and need to trust that every number matches the ERP.

## Product Purpose

ORA (Organización de Reportes para Análisis) turns ERP data into ready management reports so managers spend less time assembling numbers and more time deciding. Success means a manager opens a section, reads the state of sales, receivables or stock at a glance, and can drill down to the supporting documents that prove each figure.

## Positioning

Every figure is traceable to its source documents: cards, bars and rows open the exact invoices, applications or stock moves behind them, and totals reconcile to the ERP to the cent.

## Operating Context

- Live mode reads Odoo 17 under the signed-in user's session, one company per process; a demo mode serves a synthetic company (Distribuidora Andina).
- Each section reloads its data from Odoo, which can take several seconds; loading states are part of normal use.
- Reports are exported to Excel and PDF to be shared outside the portal.
- Spanish (Venezuela) number and date formats; amounts can reach millions.

## Capabilities and Constraints

- Sections: Ventas (resumen, documentos), Cuentas por cobrar (resumen, estados de cuenta), Clientes (directorio, mapa de Venezuela), Inventario (existencias, reposición).
- Plans: Básico (Ventas only), Intermedio and Avanzado (all sections). The server decides plan and modules.
- Stack: Python standard-library server, plain HTML/CSS and ES modules; no framework or build step. Vendored ExcelJS and jsPDF for exports.
- Group-company sales and unapplied payments are shown separately so totals reflect external business.

## Brand Commitments

None binding. The ORA name stays; logo, palette, typography and theme selector are open to replacement.

## Evidence on Hand

Real Odoo data from the pilot company and the synthetic demo dataset. No testimonials, customer logos or benchmarks exist; do not invent them.

## Product Principles

1. Trust first: a number is only shown if it can be traced and reconciled.
2. Glanceable on a phone, explorable on a desktop.
3. Calm under load: slow ERP reads never make the interface jump, blank out or lose context.
4. Plain Spanish labels that a manager understands without accounting jargon.
