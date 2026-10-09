# Proposal

## Why

The retired scheduling suite accepts Monday 22:00–Tuesday 02:00, but the rebuilt setup contract and SQL validator reject it. Restore overnight host hours so the [PRD's working-hour constraints](../../../documentations/02_product_requirements.md) can preserve this legacy scheduling behavior.

## What Changes

- Allow a weekly window to end on the following local date when its end clock is earlier than its start; equal clocks remain invalid, not an implicit 24-hour window.
- Attribute the whole window to its selected starting weekday in the host timezone, including requests confined to the following morning.
- Preserve full elapsed duration, half-open intervals, busy/focus buffers, current authority and explicit settings confirmation. Ambiguous/nonexistent boundary clocks require clarification.
- Show a next-day end label wherever weekly hours are edited or reviewed so hosts do not confirm an ambiguous display.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-feasibility`: define overnight weekly availability and boundary semantics alongside [deterministic interval feasibility](../../specs/meeting-feasibility/spec.md).

## Impact

Shared weekly-window contract; `fmat` setup validator and a new generated migration; interval expansion; weekly-hours controls, reviews and previews; contract, SQL, evaluator, integration and browser tests; owning technical/setup documentation. Existing same-day values need no migration or reinterpretation. No external provider protocol changes.

The legacy audit also found online-adjacent-travel and manual-context differences; they remain outside this bounded correction and are not silently declared equivalent. The midnight/equal-clock interpretation is stated above; no unresolved decision blocks this restoration.
